#!/usr/bin/env python3
"""Executor ACBrLib via ctypes (Python stdlib). Sem rede própria / SaaS / mock em produção.

Cada execução abre a biblioteca, carrega o INI tributário já revisado, invoca
as funções oficiais do ACBr e fecha a biblioteca. O certificado permanece
no INI da ACBrLib, fora do banco de dados e do payload do Node.
NENHUM retorno é marcado AUTORIZADA sem resposta e XML de autorização.
"""
import configparser
import base64
import ctypes as ct
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


class ACBrError(RuntimeError):
    pass


def functions(lib, name, arguments):
    fn = getattr(lib, name)
    fn.argtypes = arguments
    fn.restype = ct.c_int
    return fn


def do(lib, name, *args, types=()):
    ret = functions(lib, name, list(types))(*args)
    if ret != 0:
        raise ACBrError("%s retornou código %s; situação fiscal precisa ser consultada" % (name, ret))


def response(lib, name, args=(), types=()):
    # Não repetir operações de rede para redimensionar buffer: isso poderia emitir duas vezes.
    limit = 4 * 1024 * 1024
    buf = ct.create_string_buffer(limit)
    size = ct.c_int(limit)
    ret = functions(lib, name, list(types) + [ct.c_void_p, ct.POINTER(ct.c_int)])(
        *args, buf, ct.byref(size)
    )
    if ret != 0:
        raise ACBrError("%s falhou (%s); consultar a situação fiscal" % (name, ret))
    if size.value < 0 or size.value >= limit:
        raise ACBrError("Resposta ACBr excede limite; consultar situação fiscal")
    return buf.value.decode("utf-8", errors="replace")


def encoded(s):
    return str(s).encode("utf-8")


def parse_sections(payload):
    sections = {}
    active = None
    for line in payload.splitlines():
        match = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if match:
            active = match.group(1).strip().upper()
            sections[active] = {}
        elif active and "=" in line:
            key, value = line.split("=", 1)
            sections[active][key.strip().upper()] = value.strip()
    return sections


def local_tag(el):
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def find_text(root, tag):
    if root is None:
        return ""
    for el in root.iter():
        if local_tag(el).lower() == tag.lower():
            return (el.text or "").strip()
    return ""


def root_or_none(content):
    if not content or len(content) > 4 * 1024 * 1024:
        return None
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        return None


def nfe_identity(xml):
    root = root_or_none(xml)
    if root is None:
        raise ACBrError("ACBr não devolveu um XML de NF-e válido")
    key = ""
    for el in root.iter():
        if local_tag(el) == "infNFe":
            key = el.attrib.get("Id", "").removeprefix("NFe")
            break
    if not re.fullmatch(r"\d{44}", key):
        raise ACBrError("XML NFe sem chave de 44 dígitos; consultar situação")
    return key, find_text(root, "nNF"), find_text(root, "serie"), find_text(root, "tpAmb"), find_text(root, "CNPJ")


def amount_cents(text):
    try:
        value = Decimal(str(text).strip().replace(",", "."))
        if not value.is_finite() or value < 0 or value * 100 != (value * 100).to_integral_value():
            raise InvalidOperation
        return int(value * 100)
    except (InvalidOperation, ValueError):
        raise ACBrError("Valor tributário monetário inválido")


def nfe_total_cents(xml):
    root = root_or_none(xml)
    if root is None:
        raise ACBrError("XML NFe indisponível para validar total")
    totals = [el for el in root.iter() if local_tag(el) == "ICMSTot"]
    if len(totals) != 1:
        raise ACBrError("Total NFe inconsistente")
    value = find_text(totals[0], "vNF")
    if not value:
        raise ACBrError("XML NFe sem valor final")
    return amount_cents(value)


def authorized_nfe_xml(xml, protocol):
    root = root_or_none(xml)
    if root is None:
        return False
    signatures = [el for el in root.iter() if local_tag(el) == "Signature"]
    infos = [el for el in root.iter() if local_tag(el) == "infProt"]
    return bool(signatures and infos and
                any(find_text(el, "cStat") == "100" and find_text(el, "nProt") == protocol
                    for el in infos))


def candidate_xml(sections):
    for section, fields in sections.items():
        if section.startswith("NFE_ARQ") or section.startswith("ARQUIVO"):
            file = fields.get("ARQUIVO") or fields.get("CAMINHOCOMPLETO")
            if file:
                try:
                    p = Path(file).resolve(strict=True)
                    if p.is_file() and p.stat().st_size < 4 * 1024 * 1024:
                        return p.read_text(encoding="utf-8-sig")
                except (OSError, UnicodeError):
                    pass
    return ""


def stash_signed_xml(ini_path, xml):
    key, _, _, _, _ = nfe_identity(xml)
    dest = Path(ini_path).with_suffix(".signed.xml")
    if dest.exists():
        previous = dest.read_text(encoding="utf-8-sig")
        if previous != xml:
            raise ACBrError("XML assinado mudou após a primeira tentativa: reconciliação manual necessária")
        return key
    # Arquivo local de recuperação: somente o usuário atual pode acessar.
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(xml)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return key


def ensure_signed_number(req, key, number, series):
    """Check fiscal identity before network send or after loading signed XML."""
    if not re.fullmatch(r"[0-9]{44}", str(key)):
        raise ACBrError("Chave de acesso fiscal inválida")
    try:
        n, s = int(number), int(series)
    except (ValueError, TypeError):
        raise ACBrError("Nota sem número ou série numérica")
    if (n != int(req["number"]) or s != int(req["series"]) or
            key[6:20] != req["issuerCnpj"] or
            key[20:22] != str(req["model"]) or
            int(key[22:25]) != s or int(key[25:34]) != n or
            key[34:35] != "1" or key[35:43] != req["cNF"]):
        raise ACBrError("Identidade fiscal do XML diverge da venda e numeração reservada")


def verified_nfe_rejection(parts, key, environment):
    """Only a matching per-document SEFAZ status is a confirmed rejection.

    Duplicate/possibly authorized cStat must remain indeterminate.
    """
    ambiguous = {100, 101, 103, 104, 105, 106, 107, 108, 204, 205, 539}
    for group, values in parts.items():
        if not re.fullmatch(r"NFE[0-9]+", group):
            continue
        raw = values.get("CSTAT", "")
        if not re.fullmatch(r"[0-9]{3,4}", raw):
            continue
        status = int(raw)
        if (status in ambiguous or status < 200 or
                values.get("CHDFE") != key or
                values.get("TPAMB") != environment):
            continue
        reason = re.sub(r"[\x00-\x1f]", " ", values.get("XMOTIVO", ""))[:180].strip()
        return {"status": "REJEITADA", "cStat": status,
                "reason": reason or "Rejeição fiscal confirmada", "accessKey": key}
    return None



def confirmed_nfe_cancellation(parts, key, environment):
    """A cancellation is confirmed only by an official, matching event receipt."""
    fields = parts.get("CANCELAMENTO", {})
    protocol = fields.get("NPROT", "")
    if (fields.get("CSTAT") not in ("135", "155") or
            fields.get("CHDFE") != key or fields.get("TPAMB") != environment or
            not re.fullmatch(r"[0-9]{10,20}", protocol)):
        return None
    return {"status": "CANCELADA", "cStat": int(fields["CSTAT"]),
            "eventProtocol": protocol, "accessKey": key}


def nfe_cancel(lib, req):
    key = str(req.get("accessKey", ""))
    reason = str(req.get("reason", "")).strip()
    ensure_signed_number(req, key, req.get("number"), req.get("series"))
    if not (15 <= len(reason) <= 255) or re.search(r"[\r\n\x00]", reason):
        raise ACBrError("Justificativa de cancelamento inválida")
    response_text = response(lib, "NFE_Cancelar",
                             (encoded(key), encoded(reason), encoded(req["issuerCnpj"]), int(req["lot"])),
                             [ct.c_char_p, ct.c_char_p, ct.c_char_p, ct.c_int])
    expected = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    proof = confirmed_nfe_cancellation(parse_sections(response_text), key, expected)
    return {**proof, "environment": req["environment"]} if proof else {
        "status": "INDETERMINADO", "message": "Cancelamento sem protocolo oficial confirmado"}


def confirmed_nfe_inutilization(parts, req):
    """The XML must identify the exact number range, environment, issuer and protocol."""
    fields = parts.get("INUTILIZACAO", {})
    expected = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if fields.get("CSTAT") != "102" or fields.get("TPAMB") != expected:
        return None
    root = root_or_none(fields.get("XML", ""))
    if root is None:
        return None
    infos = [node for node in root.iter() if local_tag(node) == "infInut"]
    if len(infos) != 1:
        return None
    inf = infos[0]
    year = str(req["year"])
    fields_match = {
        "tpAmb": expected, "CNPJ": str(req["issuerCnpj"]),
        "mod": str(req["model"]), "serie": str(req["series"]),
        "nNFIni": str(req["startNumber"]), "nNFFin": str(req["endNumber"]),
        "cStat": "102"}
    if (any(find_text(inf, tag) != value for tag, value in fields_match.items()) or
            find_text(inf, "ano") not in (year, year[-2:])):
        return None
    protocol = find_text(inf, "nProt")
    if not re.fullmatch(r"[0-9]{10,20}", protocol):
        return None
    return {"status": "INUTILIZADA", "cStat": 102, "eventProtocol": protocol,
            "issuerCnpj": req["issuerCnpj"], "model": int(req["model"]),
            "series": int(req["series"]), "startNumber": int(req["startNumber"]),
            "endNumber": int(req["endNumber"])}


def nfe_inutilize(lib, req):
    reason = str(req.get("reason", "")).strip()
    if not (15 <= len(reason) <= 255) or re.search(r"[\r\n\x00]", reason):
        raise ACBrError("Justificativa de inutilização inválida")
    response_text = response(lib, "NFE_Inutilizar",
                             (encoded(req["issuerCnpj"]), encoded(reason), int(req["year"]),
                              int(req["model"]), int(req["series"]),
                              int(req["startNumber"]), int(req["endNumber"])),
                             [ct.c_char_p, ct.c_char_p, ct.c_int, ct.c_int,
                              ct.c_int, ct.c_int, ct.c_int])
    proof = confirmed_nfe_inutilization(parse_sections(response_text), req)
    return {**proof, "environment": req["environment"]} if proof else {
        "status": "INDETERMINADO", "message": "Inutilização sem XML oficial do intervalo confirmado"}


def nfe_transmit(lib, req):
    do(lib, "NFE_LimparLista")
    do(lib, "NFE_CarregarINI", encoded(req["iniPath"]), types=[ct.c_char_p])
    do(lib, "NFE_Assinar")
    do(lib, "NFE_Validar")
    signed = response(lib, "NFE_ObterXml", (0,), [ct.c_int])
    key = stash_signed_xml(req["iniPath"], signed)
    _, number, series, ambiente, cnpj = nfe_identity(signed)
    ensure_signed_number(req, key, number, series)
    if find_text(root_or_none(signed), "mod") != str(req["model"]):
        raise ACBrError("Modelo fiscal diferente do esperado para NFC-e/NF-e")
    if nfe_total_cents(signed) != int(req["amountCents"]):
        raise ACBrError("Valor total da NF-e difere do registro comercial canônico")
    expect_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if ambiente != expect_amb or cnpj.upper() != req["issuerCnpj"].upper():
        raise ACBrError("XML fiscal diverge do ambiente/CNPJ do snapshot")
    send = response(lib, "NFE_Enviar",
                    (int(req["lot"]), False, True, False),
                    [ct.c_int, ct.c_bool, ct.c_bool, ct.c_bool])
    parts = parse_sections(send)
    official = next((v for k, v in parts.items()
                     if re.fullmatch(r"NFE\d+", k) and v.get("CSTAT") == "100"), None)
    if not official:
        rejection = verified_nfe_rejection(parts, key, expect_amb)
        if rejection:
            return {**rejection, "environment": req["environment"]}
        return {"status": "INDETERMINADO", "message": "Envio ACBr não comprovou autorização por NF-e"}
    protocol = official.get("NPROT", "")
    if official.get("CHDFE") != key or official.get("TPAMB") != expect_amb or not protocol:
        return {"status": "INDETERMINADO", "message": "Protocolo sem correspondência com chave ou ambiente"}
    # ObterXml após envio pode retornar nfeProc; se não vier, ler o XML de retorno ACBr.
    received = response(lib, "NFE_ObterXml", (0,), [ct.c_int])
    if not authorized_nfe_xml(received, protocol):
        received = candidate_xml(parts)
    if not authorized_nfe_xml(received, protocol):
        return {"status": "INDETERMINADO", "message": "Protocolo recebido, mas XML processado ainda não disponível"}
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": protocol, "number": number, "series": series,
            "xml": received}


def verify_danfe_pdf(encoded):
    """Never treat an arbitrary string or PDF-like text as an ACBr DANFE."""
    if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * 1024 * 1024:
        raise ACBrError("DANFE fiscal ausente ou excessivo")
    try:
        value = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise ACBrError("ACBr devolveu PDF Base64 inválido")
    if len(value) < 16 or len(value) > 3 * 1024 * 1024 or not value.startswith(b"%PDF-") or b"%%EOF" not in value[-128:]:
        raise ACBrError("ACBr não devolveu DANFE PDF válido")
    return encoded


def nfe_danfe(lib, req):
    if req.get("kind") != "NFE" or req.get("operation") != "pdf":
        raise ACBrError("Operação PDF fiscal inválida")
    xml_path = Path(req.get("xmlPath", ""))
    if not xml_path.is_file() or not xml_path.name.endswith(".authorized.xml"):
        raise ACBrError("DANFE exige XML autorizado local")
    authorized = xml_path.read_text(encoding="utf-8-sig")
    if not authorized_nfe_xml(authorized, req.get("protocol", "")):
        raise ACBrError("DANFE exige protocolo validado")
    key, number, series, environment, issuer = nfe_identity(authorized)
    ensure_signed_number(req, key, number, series)
    if find_text(root_or_none(authorized), "mod") != str(req["model"]) or nfe_total_cents(authorized) != int(req["amountCents"]):
        raise ACBrError("XML do DANFE diverge da venda canônica")
    expected = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if environment != expected or issuer != req["issuerCnpj"]:
        raise ACBrError("XML do DANFE diverge de emitente ou ambiente")
    do(lib, "NFE_LimparLista")
    do(lib, "NFE_CarregarXML", encoded(str(xml_path)), types=[ct.c_char_p])
    pdf_base64 = response(lib, "NFE_SalvarPDF")
    return {"status":"PDF_READY", "pdfBase64":verify_danfe_pdf(pdf_base64)}


def nfe_consult(lib, req):
    path = Path(req["iniPath"]).with_suffix(".signed.xml")
    if not path.is_file():
        return {"status": "INDETERMINADO", "message": "XML assinado para consulta não localizado"}
    signed = path.read_text(encoding="utf-8-sig")
    key, number, series, environment, cnpj = nfe_identity(signed)
    ensure_signed_number(req, key, number, series)
    if find_text(root_or_none(signed), "mod") != str(req["model"]) or nfe_total_cents(signed) != int(req["amountCents"]):
        raise ACBrError("XML para consulta diverge do modelo ou total canônico")
    expect_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if environment != expect_amb or cnpj.upper() != req["issuerCnpj"].upper():
        raise ACBrError("XML de consulta com CNPJ ou ambiente divergente")
    result = response(lib, "NFE_Consultar", (encoded(key), False),
                      [ct.c_char_p, ct.c_bool])
    fields = parse_sections(result).get("CONSULTA", {})
    if fields.get("CSTAT") != "100" or fields.get("TPAMB") != expect_amb or not fields.get("NPROT"):
        return {"status": "INDETERMINADO", "message": "Consulta não retornou autorização confirmada"}
    xml = candidate_xml(parse_sections(result))
    if not authorized_nfe_xml(xml, fields["NPROT"]):
        return {"status": "INDETERMINADO", "message": "Consulta confirmou protocolo, mas falta XML processado"}
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": fields["NPROT"], "number": number,
            "series": series, "xml": xml}


def nfse_details(xml):
    root = root_or_none(xml)
    if root is None or not any(local_tag(e).lower() in ("compnfse", "nfse") for e in root.iter()):
        return None
    number = find_text(root, "Numero")
    code = find_text(root, "CodigoVerificacao")
    access_key = find_text(root, "chNFSe") or find_text(root, "ChaveNFSe")
    if not number or not code or not access_key:
        return None
    return number, code, access_key


def rps_from_ini(file):
    text = Path(file).read_text(encoding="utf-8-sig")
    sections = parse_sections(text)
    rps = sections.get("IDENTIFICACAORPS", {})
    number = rps.get("NUMERO", "")
    series = rps.get("SERIE", "")
    if not number or not series:
        raise ACBrError("INI da NFSe sem número e série RPS para reconciliação")
    return number, series, rps.get("TIPO", "1")


def nfse_transmit(lib, req):
    do(lib, "NFSE_LimparLista")
    do(lib, "NFSE_CarregarINI", encoded(req["iniPath"]), types=[ct.c_char_p])
    result = response(lib, "NFSE_Emitir",
                      (encoded(str(req["lot"])), 0, False),
                      [ct.c_char_p, ct.c_int, ct.c_bool])
    fields = parse_sections(result).get("ENVIO", {})
    if fields.get("SUCESSO") != "1" or not fields.get("NUMERONOTA"):
        return {"status": "INDETERMINADO", "message": "RPS recebido sem NFSe autorizada"}
    xml = response(lib, "NFSE_ObterXml", (0,), [ct.c_int])
    details = nfse_details(xml)
    if not details or details[0] != fields["NUMERONOTA"]:
        return {"status": "INDETERMINADO", "message": "XML NFSe oficial não disponível"}
    number, code, key = details
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": code, "number": number,
            "series": rps_from_ini(req["iniPath"])[1], "xml": xml}


def nfse_consult(lib, req):
    number, series, kind = rps_from_ini(req["iniPath"])
    response_text = response(lib, "NFSE_ConsultarNFSePorRps",
                             (encoded(number), encoded(series), encoded(kind), encoded("")),
                             [ct.c_char_p] * 4)
    parts = parse_sections(response_text)
    xml = candidate_xml(parts)
    details = nfse_details(xml)
    if not details:
        return {"status": "INDETERMINADO", "message": "Consulta RPS sem XML NFSe autoritativo"}
    issued, code, key = details
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": code, "number": issued, "series": series, "xml": xml}


_dll_directories = []


def native_library(library_path):
    # Python 3.8+ no Windows exige caminhos explicitamente autorizados para
    # resolver dependências transitivas de DLLs. Nada é copiado para System32.
    parent = Path(library_path).resolve().parent
    if os.name == "nt":
        for directory in (parent, parent / "deps"):
            if directory.is_dir():
                _dll_directories.append(os.add_dll_directory(str(directory)))
    return ct.CDLL(str(Path(library_path).resolve(strict=True)))


def probe_library(path):
    lib = native_library(path)
    prefix = "NFSE" if "nfse" in Path(path).name.lower() else "NFE"
    required = (prefix + "_Inicializar", prefix + "_Finalizar",
                prefix + "_CarregarINI", prefix + "_LimparLista")
    for name in required:
        if not hasattr(lib, name):
            raise ACBrError("DLL nativa sem exportação obrigatória: " + name)
    return {"ok": True, "library": prefix, "exports": list(required)}


def execute(req):
    if req.get("operation") not in ("transmit", "consult", "pdf", "cancel", "inutilize") or req.get("kind") not in ("NFE", "NFSE"):
        raise ACBrError("Operação fiscal inválida")
    if req.get("environment") != "HOMOLOGACAO":
        raise ACBrError("Somente homologação fiscal pode ser executada nesta versão")
    if not re.fullmatch(r"[A-Za-z0-9]{14}", str(req.get("issuerCnpj", ""))):
        raise ACBrError("CNPJ de emitente ausente")
    for field in ("libraryPath", "configPath", "iniPath"):
        if not Path(req.get(field, "")).is_file():
            raise ACBrError("Arquivo local obrigatório não encontrado: " + field)
    lib = native_library(req["libraryPath"])
    prefix = req["kind"]
    initialized = False
    try:
        do(lib, prefix + "_Inicializar", encoded(req["configPath"]), encoded(""),
           types=[ct.c_char_p, ct.c_char_p])
        initialized = True
        if req["kind"] == "NFE":
            if req["operation"] == "cancel":
                return nfe_cancel(lib, req)
            if req["operation"] == "inutilize":
                return nfe_inutilize(lib, req)
            if req["operation"] == "pdf":
                return nfe_danfe(lib, req)
            return nfe_transmit(lib, req) if req["operation"] == "transmit" else nfe_consult(lib, req)
        if req["operation"] in ("pdf", "cancel", "inutilize"):
            raise ACBrError("Operação fora do escopo ACBr NFSe")
        return nfse_transmit(lib, req) if req["operation"] == "transmit" else nfse_consult(lib, req)
    finally:
        if initialized:
            try:
                do(lib, prefix + "_Finalizar")
            except Exception:
                pass


def main():
    # Diagnóstico offline para smoke do instalador: não lê certificado nem transmite.
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        print(json.dumps({"ok": True, "frozen": bool(getattr(sys, "frozen", False))}))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "--probe":
        try:
            print(json.dumps(probe_library(sys.argv[2])))
        except Exception:
            print(json.dumps({"ok": False, "error": "Biblioteca ACBr ausente ou incompatível"}))
            sys.exit(2)
        return
    # Nunca incluir dados de notas, INIs ou segredos em tracebacks ou stderr.
    try:
        raw = sys.stdin.buffer.read(65536 + 1)
        if len(raw) > 65536:
            raise ACBrError("Comando fiscal excede limite")
        request = json.loads(raw)
        result = execute(request)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Sem confirmar situação fiscal, a aplicação manterá INDETERMINADO.
        print(json.dumps({"status": "INDETERMINADO", "message": "ACBr não confirmou operação; consulte situação fiscal"}))


if __name__ == "__main__":
    main()
