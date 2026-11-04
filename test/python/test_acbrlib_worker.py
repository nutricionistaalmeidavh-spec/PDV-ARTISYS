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

if __name__ == "__main__":
    unittest.main()
