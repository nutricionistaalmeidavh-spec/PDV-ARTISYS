'use strict';

const { writeAudit } = require('../js/core/audit-log');

function domainError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return Boolean(value);
}

function publicCategory(row) {
  return row ? { id:row.id, name:row.name, active:Boolean(row.active), createdAt:row.created_at, updatedAt:row.updated_at } : null;
}

function publicSupplier(row) {
  return row ? {
    id:row.id, name:row.name, document:row.document, phone:row.phone, email:row.email,
    active:Boolean(row.active), createdAt:row.created_at, updatedAt:row.updated_at
  } : null;
}

function createCatalogManagementService({ db, catalog, account=null, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');
  if (!catalog) throw new TypeError('Catalog service is required.');

  function removeCategory(id, actor = null) {
    const categoryId=String(id||'').trim();
    const row=db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId);
    if(!row)throw domainError(404,'Categoria nao encontrada.');
    if(!Boolean(row.active))return publicCategory(row);
    const timestamp=now();
    db.prepare('UPDATE categories SET active=0,updated_at=? WHERE id=?').run(timestamp,categoryId);
    writeAudit(db,{action:'category.remove',entity:'category',entityId:categoryId,actor,context:{name:row.name,mode:'soft-delete'}},now);
    return publicCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId));
  }

  function removeCustomer(id, actor = null) {
    const customerId=String(id||'').trim();
    const customer=catalog.getCustomer(customerId);
    if(!customer)throw domainError(404,'Cliente nao encontrado.');
    if(!customer.active)return customer;
    const timestamp=now();
    db.prepare('UPDATE customers SET active=0,updated_at=? WHERE id=?').run(timestamp,customerId);
    writeAudit(db,{action:'customer.remove',entity:'customer',entityId:customerId,actor,context:{name:customer.name,mode:'soft-delete'}},now);
    return catalog.getCustomer(customerId);
  }

  function removeSupplier(id, actor = null) {
    const supplierId=String(id||'').trim();
    const row=db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId);
    if(!row)throw domainError(404,'Fornecedor nao encontrado.');
    if(!Boolean(row.active))return publicSupplier(row);
    const timestamp=now();
    db.prepare('UPDATE suppliers SET active=0,updated_at=? WHERE id=?').run(timestamp,supplierId);
    writeAudit(db,{action:'supplier.remove',entity:'supplier',entityId:supplierId,actor,context:{name:row.name,mode:'soft-delete'}},now);
    return publicSupplier(db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId));
  }

  function ownerUserId(){return String(account?.activation?.()?.ownerUserId||'').trim()||null;}

  function activeAdminCount() {
    return Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE active=1 AND role='admin'").get()?.count||0);
  }

  function ensureAdminMutationSafe(existing, nextRole, nextActive, actor) {
    if(!existing)return;
    const ownerId=ownerUserId();
    if(ownerId&&existing.id===ownerId&&(nextRole!=='admin'||!nextActive))throw domainError(409,'O administrador proprietario da instalacao nao pode ser rebaixado ou desativado.');
    if(existing.id===String(actor?.userId||'')&&!nextActive)throw domainError(409,'Nao e permitido desativar o proprio usuario.');
    const removesLastAdmin=Boolean(existing.active)&&existing.role==='admin'&&(nextRole!=='admin'||!nextActive)&&activeAdminCount()<=1;
    if(removesLastAdmin)throw domainError(409,'Nao e permitido remover ou desativar o ultimo administrador ativo.');
  }

  function saveManagedUser(input = {}, actor = null) {
    const actorRole=String(actor?.role||'');
    if(!['admin','manager'].includes(actorRole))throw domainError(403,'Permissao insuficiente.');
    const id=String(input.id||'').trim();
    const existing=id?catalog.getUser(id):null;
    const requestedRole=String(input.role||existing?.role||'').trim().toLowerCase();
    const requestedActive=asBoolean(input.active,existing?.active??true);

    if(actorRole==='manager'){
      if(requestedRole==='admin'||existing?.role==='admin')throw domainError(403,'Gerente nao pode criar, promover ou alterar administradores.');
      if(existing&&requestedActive!==existing.active)throw domainError(403,'Somente administrador pode ativar ou desativar usuarios.');
      if(!existing&&!requestedActive)throw domainError(403,'Somente administrador pode criar usuario inativo.');
    }

    if(actorRole==='admin')ensureAdminMutationSafe(existing,requestedRole,requestedActive,actor);
    return catalog.upsertUser({...input,role:requestedRole,active:requestedActive},actor);
  }

  function removeUser(id, actor = null) {
    if(String(actor?.role||'')!=='admin')throw domainError(403,'Somente administrador pode desativar usuarios.');
    const userId=String(id||'').trim();
    const user=catalog.getUser(userId);
    if(!user)throw domainError(404,'Usuario nao encontrado.');
    if(!user.active)return user;
    ensureAdminMutationSafe(user,user.role,false,actor);
    const timestamp=now();
    db.prepare('UPDATE users SET active=0,updated_at=? WHERE id=?').run(timestamp,userId);
    writeAudit(db,{action:'user.remove',entity:'user',entityId:userId,actor,context:{username:user.username,name:user.name,role:user.role,mode:'soft-delete'}},now);
    return catalog.getUser(userId);
  }

  return { removeCategory, removeCustomer, removeSupplier, removeUser, saveManagedUser };
}

module.exports={createCatalogManagementService,asBoolean};
