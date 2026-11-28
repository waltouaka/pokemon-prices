// Added to the replay panel by the site gate: a "← Home" button back to the homepage.
(() => {
  const a = document.createElement('a');
  a.href = 'https://outlawswitchmyshit.com/'; a.title = 'Back to home'; a.innerHTML = '←<span> Home</span>';
  a.style.cssText = 'position:fixed;top:14px;left:14px;z-index:9999;display:inline-flex;align-items:center;gap:4px;height:36px;padding:0 14px;border-radius:10px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font:800 14px Archivo,system-ui,sans-serif;backdrop-filter:blur(6px);transition:background .15s';
  a.onmouseenter = () => a.style.background = 'rgba(255,255,255,.16)';
  a.onmouseleave = () => a.style.background = 'rgba(255,255,255,.08)';
  document.body.appendChild(a);
})();
