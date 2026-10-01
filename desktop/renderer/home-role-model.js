'use strict';

((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.PdvHomeRoleModel = model;
})(typeof window !== 'undefined' ? window : null, () => {
  const ADMIN_TILES = Object.freeze({
    'financial-management': Object.freeze({ key:'financial-management', label:'Gestão financeira', description:'DRE, relatórios e contas a pagar e receber', route:'financial-management', tone:'rose', icon:'management' })
  });

  const PRESETS = Object.freeze({
    cashier: Object.freeze({
      label: 'Caixa',
      title: 'Início',
      subtitle: 'Acesso rápido à operação do caixa.',
      sections: Object.freeze([
        Object.freeze({ key:'cashier-primary', label:'', routes:Object.freeze(['checkout','cash','sales','returns']) })
      ])
    }),
    manager: Object.freeze({
      label: 'Gerente',
      title: 'Início',
      subtitle: 'Operação e visão do negócio em um só lugar.',
      sections: Object.freeze([
        Object.freeze({ key:'manager-main', label:'', routes:Object.freeze(['financial-management','inventory','checkout','cash','sales','returns','products','customers']) })
      ])
    }),
    admin: Object.freeze({
      label: 'Administrador',
      title: 'Início',
      subtitle: 'Atalhos principais da operação e da gestão.',
      sections: Object.freeze([
        Object.freeze({ key:'admin-main', label:'', routes:Object.freeze(['financial-management','inventory','checkout','cash','sales','returns','products','customers']) })
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
    reports: Object.freeze(['admin','manager']),
    management: Object.freeze(['admin','manager']),
    sellers: Object.freeze(['admin','manager']),
    settings: Object.freeze(['admin','manager'])
    ,catalog: Object.freeze(['admin','manager'])
    ,'post-sale': Object.freeze(['admin','manager','cashier'])
    ,'financial-management': Object.freeze(['admin','manager'])
  });

  function canAccessRoute(role, route) {
    return Boolean(ROUTE_ACCESS[route]?.includes(role));
  }

  function routesForRole(role) {
    const menu = role === 'cashier'
      ? ['home','checkout','cash','post-sale','customers']
      : ['home','checkout','cash','post-sale','customers','catalog','financial-management','sellers'];
    return menu.filter(route => canAccessRoute(role, route));
  }

  function homeForRole(role, baseTiles = []) {
    const normalizedRole = Object.hasOwn(PRESETS, role) ? role : 'cashier';
    const preset = PRESETS[normalizedRole];
    const tiles = new Map(baseTiles.map((tile) => [tile.route, tile]));
    Object.entries(ADMIN_TILES).forEach(([key, tile]) => tiles.set(key, tile));
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

  return Object.freeze({ ADMIN_TILES, PRESETS, ROUTE_ACCESS, canAccessRoute, routesForRole, homeForRole });
});
