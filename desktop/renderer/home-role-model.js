'use strict';

((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.PdvHomeRoleModel = model;
})(typeof window !== 'undefined' ? window : null, () => {
  const HUB_TILES = Object.freeze({
    catalog: Object.freeze({ key:'catalog', label:'Cadastros', description:'Clientes, produtos, estoque e equipe', route:'catalog', tone:'purple', icon:'document' }),
    'post-sale': Object.freeze({ key:'post-sale', label:'Vendas e devoluções', description:'Histórico, comprovantes e devoluções', route:'post-sale', tone:'slate', icon:'history' }),
    'financial-management': Object.freeze({ key:'financial-management', label:'Gestão financeira', description:'DRE, relatórios e financeiro', route:'financial-management', tone:'rose', icon:'management' }),
    settings: Object.freeze({ key:'settings', label:'Configurações', description:'Empresa, equipe, áreas e dispositivos', route:'settings', tone:'sky', icon:'modules' })
  });

  const PRESETS = Object.freeze({
    cashier: Object.freeze({
      label: 'Caixa',
      title: 'Início',
      subtitle: 'Acesso rápido à operação do caixa.',
      sections: Object.freeze([
        Object.freeze({ key:'cashier-primary', label:'', routes:Object.freeze(['checkout','cash','post-sale','catalog']) })
      ])
    }),
    manager: Object.freeze({
      label: 'Gerente',
      title: 'Início',
      subtitle: 'Operação e visão do negócio em um só lugar.',
      sections: Object.freeze([
        Object.freeze({ key:'manager-main', label:'', routes:Object.freeze(['checkout','cash','post-sale','catalog','financial-management']) })
      ])
    }),
    admin: Object.freeze({
      label: 'Administrador',
      title: 'Início',
      subtitle: 'Atalhos principais da operação e da gestão.',
      sections: Object.freeze([
        Object.freeze({ key:'admin-main', label:'', routes:Object.freeze(['checkout','cash','post-sale','catalog','financial-management','settings']) })
      ])
    })
  });

  const ROUTE_ACCESS = Object.freeze({
    home: Object.freeze(['admin','manager','cashier']),
    checkout: Object.freeze(['admin','manager','cashier']),
    cash: Object.freeze(['admin','manager','cashier']),
    sales: Object.freeze(['admin','manager','cashier']),
    returns: Object.freeze(['admin','manager','cashier']),
    customers: Object.freeze(['admin','manager','cashier']),
    products: Object.freeze(['admin','manager']),
    inventory: Object.freeze(['admin','manager']),
    finance: Object.freeze(['admin','manager']),
    'finance-banks': Object.freeze(['admin','manager']),
    'finance-recurrences': Object.freeze(['admin','manager']),
    'finance-alerts': Object.freeze(['admin','manager']),
    reports: Object.freeze(['admin','manager']),
    management: Object.freeze(['admin','manager']),
    sellers: Object.freeze(['admin','manager']),
    settings: Object.freeze(['admin','manager'])
    ,catalog: Object.freeze(['admin','manager','cashier'])
    ,'post-sale': Object.freeze(['admin','manager','cashier'])
    ,'financial-management': Object.freeze(['admin','manager'])
  });

  function canAccessRoute(role, route) {
    return Boolean(ROUTE_ACCESS[route]?.includes(role));
  }

  function routesForRole(role) {
    const menu = role === 'cashier'
      ? ['home','checkout','cash','post-sale','catalog']
      : ['home','checkout','cash','post-sale','catalog','financial-management'];
    return menu.filter(route => canAccessRoute(role, route));
  }

  function homeForRole(role, baseTiles = []) {
    const normalizedRole = Object.hasOwn(PRESETS, role) ? role : 'cashier';
    const preset = PRESETS[normalizedRole];
    const tiles = new Map(baseTiles.map((tile) => [tile.route, tile]));
    Object.entries(HUB_TILES).forEach(([key, tile]) => tiles.set(key, tile));
    return {
      role: normalizedRole,
      label: preset.label,
      title: preset.title,
      subtitle: preset.subtitle,
      sections: preset.sections.map((section) => ({
        ...section,
        tiles: section.routes.map((key) => tiles.get(key)).filter(Boolean)
      })).filter((section) => section.tiles.length)
    };
  }

  return Object.freeze({ HUB_TILES, PRESETS, ROUTE_ACCESS, canAccessRoute, routesForRole, homeForRole });
});
