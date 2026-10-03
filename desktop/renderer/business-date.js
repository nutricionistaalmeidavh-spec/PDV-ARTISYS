'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvBusinessDate = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function localBusinessDate(value = new Date(), timeZone = null) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Data invalida.');
    const options = { year:'numeric', month:'2-digit', day:'2-digit' };
    if (timeZone) options.timeZone = String(timeZone);
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  return Object.freeze({ localBusinessDate });
});
