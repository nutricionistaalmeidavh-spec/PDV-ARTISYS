'use strict';

((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.PdvHomeRoleModel = model;
})(typeof window !== 'undefined' ? window : null, () => {
  const ADMIN_TILES = Object.freeze({
    team: Object.freeze({ key:'team', label:'Equipe', description:'Usuários, perfis e acessos', route:'sellers', tone:'blue', icon:'users' }),
    devices: Object.freeze({ key:'devices', label:'Dispositivos', description:'Terminal, impressora, leitor e balança', route:'settings', target:'#settings-devices', tone:'cyan', icon:'device' }),
    fiscal: Object.freeze({ key:'fiscal', label:'Fiscal', description:'Configuração, certificado e produção', route:'settings', target:'#settings-fiscal', tone:'orange', icon:'shield' }),
    backup: Object.freeze({ key:'backup', label:'Backup', description:'Cópias de segurança e recuperação', route:'settings', target:'#settings-backup', tone:'purple', icon:'database' }),
    modules: Object.freeze({ key:'modules', label:'Módulos', description:'Recursos habilitados no estabelecimento', route:'settings', target:'#ops-establishment-modules-card', tone:'green', icon:'modules' })
  });

  const PRESETS = Object.freeze({
    cashier: Object.freeze({
      label: 'Caixa',
      title: 'Atendimento do caixa',
      subtitle: 'Venda, caixa e pós-venda reunidos em uma única entrada.',
      sections: Object.freeze([
        Object.freeze({ key:'cashier-primary', label:'Ações principais', routes:Object.freeze(['checkout','cash']) }),
        Object.freeze({ key:'cashier-operation', label:'Operação', routes:Object.freeze(['sales','returns']) })
      ])
    }),
    manager: Object.freeze({
      label: 'Gerente',
      title: 'Visão da operação',
      subtitle: 'Indicadores, estoque e rotinas da equipe no mesmo painel.',
      sections: Object.freeze([
        Object.freeze({ key:'manager-management', label:'Gestão do negócio', routes:Object.freeze(['management','inventory','finance','reports']) }),
        Object.freeze({ key:'manager-operation', label:'Operação', routes:Object.freeze(['cash','sales','returns']) }),
        Object.freeze({ key:'manager-registers', label:'Cadastros', routes:Object.freeze(['products','customers','sellers']) })
      ])
    }),
    admin: Object.freeze({
      label: 'Administrador',
      title: 'Administração do sistema',
      subtitle: 'Equipe, infraestrutura e visão completa do negócio.',
      sections: Object.freeze([
        Object.freeze({ key:'admin-control', label:'Administração', routes:Object.freeze(['team','devices','fiscal','backup','modules']) }),
        Object.freeze({ key:'admin-management', label:'Visão do negócio', routes:Object.freeze(['management','reports','finance','inventory']) }),
        Object.freeze({ key:'admin-operation', label:'Operação e cadastros', routes:Object.freeze(['checkout','cash','sales','returns','products','customers']) })
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
  });

  function canAccessRoute(role, route) {
    return Boolean(ROUTE_ACCESS[route]?.includes(role));
  }

  function canAccessModule(role) {
    return ['admin','manager'].includes(role);
  }

  function routesForRole(role) {
    return Object.keys(ROUTE_ACCESS).filter(route => canAccessRoute(role, route));
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

  return Object.freeze({ ADMIN_TILES, PRESETS, ROUTE_ACCESS, canAccessRoute, canAccessModule, routesForRole, homeForRole });
});
