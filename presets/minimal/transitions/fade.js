export async function play({ container, covered, signal }) {
  const curtain = document.createElement('div');
  Object.assign(curtain.style, { position: 'absolute', inset: '0', background: '#000' }); container.append(curtain);
  const cleanup = () => { curtain.getAnimations().forEach(animation => animation.cancel()); curtain.remove(); };
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    await curtain.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' }).finished;
    signal.throwIfAborted(); covered();
    await curtain.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished;
  } finally { signal.removeEventListener('abort', cleanup); cleanup(); }
}
