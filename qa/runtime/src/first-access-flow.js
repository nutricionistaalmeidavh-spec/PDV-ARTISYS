function selectorOf(step) {
  return typeof step?.selector === 'string' ? step.selector : '';
}

export function normalizeFirstAccessFlowSteps(steps) {
  if (!Array.isArray(steps) || !steps.some(step => selectorOf(step).includes('#setup-form'))) return steps;

  const normalized = [];
  let skipLegacyLogin = false;

  for (const step of steps) {
    const selector = selectorOf(step);

    if (skipLegacyLogin && selector.includes('#login-form')) continue;
    if (skipLegacyLogin && selector === '#auth-overlay' && step.state === 'hidden') {
      normalized.push(structuredClone(step));
      skipLegacyLogin = false;
      continue;
    }

    if (!selector.includes('#setup-form')) {
      normalized.push(structuredClone(step));
      continue;
    }

    const upgraded = {
      ...structuredClone(step),
      selector: selector.replaceAll('#setup-form', '#first-access-form'),
    };
    normalized.push(upgraded);

    if (step.action === 'fill' && /input\[name=['"]password['"]\]/.test(selector)) {
      normalized.push({
        ...structuredClone(upgraded),
        selector: "#first-access-form input[name='passwordConfirm']",
        name: `${step.name || 'setup-admin-password'}-confirm`,
      });
    }

    if (step.action === 'click' && /button\[type=['"]submit['"]\]/.test(selector)) skipLegacyLogin = true;
  }

  return normalized;
}
