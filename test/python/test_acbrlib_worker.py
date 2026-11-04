import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "server" / "acbrlib" / "acbrlib-worker.py"
spec = importlib.util.spec_from_file_location("acbrlib_worker", MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

KEY = "35261111222333000181550010000000011000000011"

class AcbrWorkerSecurityTests(unittest.TestCase):
    def test_parses_actual_acbr_style_ini_sections(self):
        result = worker.parse_sections(
            "[ENVIO]\nTpAmb=2\nCStat=103\n[NFE1]\nCStat=100\n"
            "NProt=13512345\nchDFe=" + KEY + "\n"
        )
        self.assertEqual(result["ENVIO"]["CSTAT"], "103")
        self.assertEqual(result["NFE1"]["NPROT"], "13512345")

    def test_nfe_requires_signature_and_matching_official_protocol(self):
        xml = ('<nfeProc><NFe><infNFe Id="NFe' + KEY + '"><ide>'
               '<nNF>1</nNF><serie>1</serie><tpAmb>2</tpAmb></ide>'
               '<emit><CNPJ>11222333000181</CNPJ></emit></infNFe>'
               '<Signature/></NFe><protNFe><infProt><cStat>100</cStat>'
               '<nProt>13512345</nProt></infProt></protNFe></nfeProc>')
        self.assertTrue(worker.authorized_nfe_xml(xml, "13512345"))
        self.assertFalse(worker.authorized_nfe_xml(xml, "OUTRA"))
        self.assertFalse(worker.authorized_nfe_xml(xml.replace("<Signature/>", ""), "13512345"))
        self.assertEqual(worker.nfe_identity(xml)[0], KEY)

    def test_xml_nfe_must_match_the_canonical_amount(self):
        xml = '<NFe><infNFe Id="NFe' + KEY + '"></infNFe><total><ICMSTot><vNF>123.45</vNF></ICMSTot></total></NFe>'
        self.assertEqual(worker.nfe_total_cents(xml), 12345)
        self.assertNotEqual(worker.nfe_total_cents(xml), 12346)
        with self.assertRaises(worker.ACBrError):
            worker.nfe_total_cents('<NFe><total></total></NFe>')
    def test_receipt_only_is_not_nfse_authorization(self):
        self.assertIsNone(worker.nfse_details('<Envio><Sucesso>1</Sucesso><Protocolo>123</Protocolo></Envio>'))
        self.assertIsNone(worker.nfse_details('<CompNfse><Nfse><InfNfse><Numero>1</Numero>'
                                              '<CodigoVerificacao>ABC</CodigoVerificacao></InfNfse></Nfse></CompNfse>'))


    def test_signed_identity_must_match_exact_nfe_number_serie_and_cnf(self):
        req = {"issuerCnpj":"11222333000181","model":55,"number":1,"series":1,"cNF":"00000001"}
        worker.ensure_signed_number(req, KEY, "1", "1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"number":2}, KEY, "1", "1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"series":2}, KEY, "1", "1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"issuerCnpj":"99999999000199"}, KEY, "1", "1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"cNF":"87654321"}, KEY, "1", "1")


    def test_official_per_invoice_rejection_is_distinguished_from_ambiguous_response(self):
        response = {"NFE1":{"CSTAT":"778","CHDFE":KEY,"TPAMB":"2","XMOTIVO":"NFC-e rejeitada"}}
        result = worker.verified_nfe_rejection(response, KEY, "2")
        self.assertEqual(result["status"], "REJEITADA")
        self.assertEqual(result["cStat"], 778)
        self.assertEqual(result["reason"], "NFC-e rejeitada")
        self.assertIsNone(worker.verified_nfe_rejection(response, KEY, "1"))
        self.assertIsNone(worker.verified_nfe_rejection(response, "2"*44, "2"))
        self.assertIsNone(worker.verified_nfe_rejection({"ENVIO":{"CSTAT":"778"}},KEY,"2"))
        self.assertIsNone(worker.verified_nfe_rejection({"NFE1":{"CSTAT":"204","CHDFE":KEY,"TPAMB":"2"}},KEY,"2"))
        self.assertIsNone(worker.verified_nfe_rejection({"NFE1":{"CSTAT":"539","CHDFE":KEY,"TPAMB":"2"}},KEY,"2"))

    def test_acbr_pdf_payload_is_validated_not_fabricated(self):
        import base64
        original = b"%PDF-1.7\\n1 0 obj\\n<<>>\\nendobj\\n%%EOF"
        encoded = base64.b64encode(original).decode("ascii")
        self.assertEqual(worker.verify_danfe_pdf(encoded), encoded)
        for invalid in ("", "abcd", base64.b64encode(b"not a pdf").decode("ascii"),
                        base64.b64encode(b"%PDF-1.4 missing trailer").decode("ascii")):
            with self.assertRaises(worker.ACBrError):
                worker.verify_danfe_pdf(invalid)

    def test_wrong_environment_and_missing_binary_fail_before_ctypes(self):
        with self.assertRaises(worker.ACBrError):
            worker.execute({"operation": "transmit", "kind": "NFE", "environment": "DEV"})
        with self.assertRaises(worker.ACBrError):
            worker.execute({"operation": "transmit", "kind": "NFE", "environment": "HOMOLOGACAO",
                            "issuerCnpj": "11222333000181", "libraryPath": "/nonexistent/library.so",
                            "configPath": "/missing", "iniPath": "/missing"})


    def test_cancellation_proof_requires_original_key_environment_and_event_protocol(self):
        event = {"CANCELAMENTO":{"CSTAT":"135","CHDFE":KEY,"TPAMB":"2","NPROT":"135260000000111"}}
        ok = worker.confirmed_nfe_cancellation(event, KEY, "2")
        self.assertEqual(ok["status"], "CANCELADA")
        self.assertEqual(ok["eventProtocol"], "135260000000111")
        self.assertIsNone(worker.confirmed_nfe_cancellation(event, "0"*44, "2"))
        self.assertIsNone(worker.confirmed_nfe_cancellation(event, KEY, "1"))
        self.assertIsNone(worker.confirmed_nfe_cancellation({"CANCELAMENTO":{"CSTAT":"135"}}, KEY, "2"))

    def test_inutilization_proof_requires_matching_range_and_official_xml(self):
        xml = ('<retInutNFe><infInut><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ>'
               '<ano>26</ano><mod>55</mod><serie>1</serie><nNFIni>2</nNFIni><nNFFin>3</nNFFin>'
               '<cStat>102</cStat><nProt>135260000000222</nProt></infInut></retInutNFe>')
        req = {"issuerCnpj":"11222333000181","environment":"HOMOLOGACAO","year":2026,
               "model":55,"series":1,"startNumber":2,"endNumber":3}
        ok = worker.confirmed_nfe_inutilization({"INUTILIZACAO":{"CSTAT":"102","TPAMB":"2","XML":xml}}, req)
        self.assertEqual(ok["status"], "INUTILIZADA")
        self.assertIsNone(worker.confirmed_nfe_inutilization({"INUTILIZACAO":{"CSTAT":"102","TPAMB":"2","XML":xml}}, {**req,"startNumber":4}))


    def test_cce_ini_uses_official_nfe_event_and_blocks_ini_injection(self):
        request = {"issuerCnpj":"11222333000181", "accessKey":KEY,"model":55,
                   "environment":"HOMOLOGACAO","sequence":1,"lot":1,
                   "eventAt":"2026-11-04T15:40:00-03:00",
                   "correction":"Correcao da descricao de produto sem mudar valores fiscais."}
        payload = worker.nfe_cce_ini(request)
        self.assertIn("[EVENTO001]", payload)
        self.assertIn("tpEvento=110110", payload)
        self.assertIn("chNFe="+KEY, payload)
        self.assertIn("nSeqEvento=1", payload)
        self.assertIn("versaoEvento=1.00", payload)
        self.assertIn("xCorrecao=",payload)
        with self.assertRaises(worker.ACBrError):
            worker.nfe_cce_ini({**request,"correction":"Correcao normal\n[EVENTO002]\nCNPJ=99999999000199"})
        with self.assertRaises(worker.ACBrError):
            worker.nfe_cce_ini({**request,"model":65})
        with self.assertRaises(worker.ACBrError):
            worker.nfe_cce_ini({**request,"environment":"PRODUCAO"})

    def test_cce_accepts_only_matching_official_event_protocol(self):
        response = {"EVENTO001":{"TPAMB":"2", "CSTAT":"135", "CHDFE":KEY,
                                 "NPROT":"135260000000987","TPEVENTO":"110110","NSEQEVENTO":"1"}}
        proof=worker.confirmed_nfe_cce(response,KEY,"2",1)
        self.assertEqual(proof["status"],"CCE_REGISTERED")
        self.assertEqual(proof["eventProtocol"],"135260000000987")
        self.assertIsNone(worker.confirmed_nfe_cce(response, "0"*44,"2",1))
        self.assertIsNone(worker.confirmed_nfe_cce(response,KEY,"1",1))
        self.assertIsNone(worker.confirmed_nfe_cce(response,KEY,"2",2))
        self.assertIsNone(worker.confirmed_nfe_cce(
            {"EVENTO001":{**response["EVENTO001"],"CSTAT":"136"}},KEY,"2",1))
        self.assertIsNone(worker.confirmed_nfe_cce(
            {"EVENTO001":{**response["EVENTO001"],"TPEVENTO":"110111"}},KEY,"2",1))

    def test_offline_nfc_e_key_and_signature_not_relabelled_as_normal(self):
        req={"issuerCnpj":"11222333000181","model":65,"number":1,
             "series":1,"cNF":"00000001","issuanceMode":"nfce-offline"}
        raw="3526111122233300018165001000000001900000001"
        weight=2
        total=0
        for digit in reversed(raw):
            total+=int(digit)*weight
            weight=2 if weight==9 else weight+1
        check=11-total%11
        key=raw+str(0 if check>=10 else check)
        worker.ensure_signed_number(req,key,"1","1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"issuanceMode":"normal"},key,"1","1")
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_number({**req,"model":55},key,"1","1")


    def test_signed_xml_mode_prevents_offline_documents_being_relabelled_as_normal(self):
        offline = ('<NFe><infNFe><ide><tpEmis>9</tpEmis>'
                   '<dhCont>2026-11-04T15:30:00-03:00</dhCont>'
                   '<xJust>Falha de rede testada com NFC-e</xJust>'
                   '</ide></infNFe></NFe>')
        worker.ensure_signed_issuance_mode(offline, {"model":65,"issuanceMode":"nfce-offline"})
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_issuance_mode(offline, {"model":65,"issuanceMode":"normal"})
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_issuance_mode(offline.replace("<tpEmis>9</tpEmis>","<tpEmis>1</tpEmis>"),
                                              {"model":65,"issuanceMode":"nfce-offline"})
        with self.assertRaises(worker.ACBrError):
            worker.ensure_signed_issuance_mode(offline.replace("<xJust>Falha de rede testada com NFC-e</xJust>",""),
                                              {"model":65,"issuanceMode":"nfce-offline"})
        worker.ensure_signed_issuance_mode("<NFe><ide><tpEmis>1</tpEmis></ide></NFe>",
                                          {"model":55,"issuanceMode":"normal"})

if __name__ == "__main__":
    unittest.main()
