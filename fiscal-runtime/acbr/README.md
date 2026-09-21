# ACBr runtime slot

Este diretório é copiado pelo `electron-builder` para `resources/fiscal/acbr`, fora de `app.asar`.

O PDV não baixa binários em runtime e não depende de servidor ArtiSys ou API fiscal paga. O executável oficial do ACBr Monitor deve ser inserido aqui pelo processo de distribuição homologado, preservando licença, origem e integridade do artefato. O nome esperado pelo manifesto atual é `ACBrMonitorPLUS.exe`.

A ausência do binário não impede o PDV de vender: apenas mantém a emissão fiscal local indisponível, conforme os invariantes do Roadmap Fiscal. Não substituir este artefato por executável fictício em builds de produção.
