'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { validateConnection, validateReference } = require('./fiscal-core');

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
}

function createFiscalService({ db, outbox, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');

  function mapDocument(row) {
    if (!row) return null;
    const metadata = parseJson(row.response_json, {});
    return {
      id: row.id,
      saleId: row.sale_id,
      provider: row.provider,
      documentType: row.document_type,
      environment: row.environment,
      reference: row.reference,
      status: row.status,
      accessKey: row.access_key,
      number: row.number,
      series: row.series,
      issuedAt: row.issued_at,
      cancelledAt: row.cancelled_at,
      lastError: row.last_error,
      requestPayload: metadata.requestPayload || {},
      providerResponse: metadata.providerResponse || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getDocument(id) {
    return mapDocument(db.prepare('SELECT * FROM fiscal_documents WHERE id=?').get(String(id)));
  }

  function getByReference(reference) {
    return mapDocument(db.prepare('SELECT * FROM fiscal_documents WHERE reference=?').get(validateReference(reference)));
  }

  function requireDocument(id) {
    const row = db.prepare('SELECT * FROM fiscal_documents WHERE id=?').get(String(id));
    if (!row) throw new Error('Documento fiscal nao encontrado.');
    return row;
  }

  function requireSale(saleId) {
    const row = db.prepare('SELECT * FROM sales WHERE id=?').get(String(saleId));
    if (!row) throw new Error('Venda nao encontrada para emissao fiscal.');
    if (row.status !== 'COMPLETED') throw new Error('Somente venda concluida pode gerar documento fiscal.');
    return row;
  }

  function eventEnvelope({ type, documentId, actor = {}, mutationId = null, payload = {} }) {
    return {
      eventId: String(idFactory('event')),
      type,
      aggregate: 'fiscal-document',
      aggregateId: String(documentId),
      occurredAt: now(),
      actor: actor && typeof actor === 'object' ? actor : {},
      source: 'server',
      mutationId: mutationId || null,
      payload
    };
  }

  function requestIssue(input = {}) {
    const connection = validateConnection(input);
    const sale = requireSale(input.saleId);
    const reference = validateReference(input.reference || sale.sale_number);
    const requestPayload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    const actor = input.actor && typeof input.actor === 'object' ? input.actor : {};
    return withTransaction(db, () => {
      const existing = getByReference(reference);
      if (existing) return existing;
      const id = String(input.id || idFactory('fiscal'));
      const timestamp = now();
      db.prepare(`INSERT INTO fiscal_documents
        (id,sale_id,provider,document_type,environment,reference,status,response_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'PENDING',?,?,?)`)
        .run(id, String(input.saleId), connection.provider, connection.documentType, connection.environment, reference,
          JSON.stringify({ requestPayload, providerResponse:null }), timestamp, timestamp);
      outbox.insert(eventEnvelope({
        type:'fiscal.issue-requested',
        documentId:id,
        actor,
        mutationId:input.mutationId || null,
        payload:{ saleId:String(input.saleId), provider:connection.provider, documentType:connection.documentType, environment:connection.environment, reference }
      }));
      writeAudit(db,{action:'fiscal.issue.request',entity:'fiscal-document',entityId:id,actor,context:{saleId:String(input.saleId),provider:connection.provider,documentType:connection.documentType,environment:connection.environment,reference}},now);
      return getDocument(id);
    });
  }

  function retryIssue(id, { actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const row = requireDocument(id);
      if (!['FAILED','PENDING'].includes(row.status)) throw new Error('Somente documento pendente ou com falha pode ser reenviado.');
      db.prepare("UPDATE fiscal_documents SET status='PENDING',last_error=NULL,updated_at=? WHERE id=?").run(now(), String(id));
      outbox.insert(eventEnvelope({
        type:'fiscal.issue-requested', documentId:String(id), actor, mutationId,
        payload:{ saleId:row.sale_id, provider:row.provider, documentType:row.document_type, environment:row.environment, reference:row.reference, retry:true }
      }));
      writeAudit(db,{action:'fiscal.issue.retry',entity:'fiscal-document',entityId:String(id),actor,context:{reference:row.reference}},now);
      return getDocument(id);
    });
  }

  function saveProviderResponse(id, { status, data = null, error = null } = {}) {
    const row = requireDocument(id);
    const current = parseJson(row.response_json, {});
    const metadata = { requestPayload:current.requestPayload || {}, providerResponse:data };
    db.prepare('UPDATE fiscal_documents SET response_json=?,last_error=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(metadata), error ? String(error).slice(0,4000) : null, now(), String(id));
    return { ...getDocument(id), statusCode:status || null };
  }

  function markIssued(id, result = {}, actor = {}) {
    return withTransaction(db, () => {
      const row = requireDocument(id);
      const data = result.data && typeof result.data === 'object' ? result.data : {};
      saveProviderResponse(id, { status:result.status, data, error:null });
      const timestamp = now();
      db.prepare(`UPDATE fiscal_documents SET status='ISSUED',access_key=?,number=?,series=?,issued_at=?,last_error=NULL,updated_at=? WHERE id=?`)
        .run(data.chave_nfe || data.chave_nfce || data.chave || null, data.numero != null ? String(data.numero) : null,
          data.serie != null ? String(data.serie) : null, timestamp, timestamp, String(id));
      outbox.insert(eventEnvelope({type:'fiscal.issued',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference}}));
      return getDocument(id);
    });
  }

  function markFailed(id, result = {}, actor = {}) {
    return withTransaction(db, () => {
      const row = requireDocument(id);
      const message = String(result.error || result.data?.mensagem || result.data?.message || 'Falha na emissao fiscal.').slice(0,4000);
      saveProviderResponse(id, { status:result.status, data:result.data || null, error:message });
      db.prepare("UPDATE fiscal_documents SET status='FAILED',last_error=?,updated_at=? WHERE id=?").run(message, now(), String(id));
      outbox.insert(eventEnvelope({type:'fiscal.failed',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference,error:message}}));
      return getDocument(id);
    });
  }

  function markCancelled(id, result = {}, actor = {}) {
    return withTransaction(db, () => {
      const row = requireDocument(id);
      saveProviderResponse(id, { status:result.status, data:result.data || null, error:null });
      const timestamp = now();
      db.prepare("UPDATE fiscal_documents SET status='CANCELLED',cancelled_at=?,last_error=NULL,updated_at=? WHERE id=?")
        .run(timestamp,timestamp,String(id));
      outbox.insert(eventEnvelope({type:'fiscal.cancelled',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference}}));
      return getDocument(id);
    });
  }

  function listDocuments(filters = {}) {
    const clauses = []; const params = [];
    if (filters.saleId) { clauses.push('sale_id=?'); params.push(String(filters.saleId)); }
    if (filters.status) { clauses.push('status=?'); params.push(String(filters.status).toUpperCase()); }
    if (filters.documentType) { clauses.push('document_type=?'); params.push(String(filters.documentType).toLowerCase()); }
    if (filters.environment) { clauses.push('environment=?'); params.push(String(filters.environment).toLowerCase()); }
    const rows = db.prepare(`SELECT * FROM fiscal_documents${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC`).all(...params);
    return rows.map(mapDocument);
  }

  return { requestIssue, retryIssue, getDocument, getByReference, listDocuments, markIssued, markFailed, markCancelled };
}

module.exports = { createFiscalService };
