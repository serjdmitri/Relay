// The Flick button at the bottom of the home page. Once flick (motion) has been turned on, a tap opens the photo picker straight away; before that it opens the Flick page so it can be turned on there.

(function () {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('flickfab'), pick = document.getElementById('flickpick');
  if (!btn || !pick) return;
  const ready = () => { try { return localStorage.getItem('relay-flick-motion') === '1'; } catch { return false; } };
  btn.addEventListener('click', () => { if (ready()) pick.click(); else location.href = '/flick.html'; });
  pick.addEventListener('change', async () => {
    const files = [...pick.files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|gif|webp)$/i.test(f.name));
    pick.value = '';
    if (!files.length) return;
    try { await FlickStore.put(files); } catch { /* the Flick page then asks for the photos itself */ }
    location.href = '/flick.html';
  });
})();
