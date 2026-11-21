/** Privacy mode's storage key and the inline script that restores it before first paint. */
export const PRIVACY_KEY = 'slates-privacy';
// Lives outside the 'use client' component so the root layout gets the string, not a client reference.
export const PRIVACY_BOOT = `(function(){try{if(localStorage.getItem('${PRIVACY_KEY}')==='1')document.documentElement.classList.add('privacy-on')}catch(e){}})();`;
