const backButton = document.querySelector('[data-notag-back]');
if (backButton) backButton.addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign('/');
});
