// Keyboard and mouse input. Writes into state.input each frame; the sim
// consumes the edge-triggered flags (firePressed, reload, buy, use, grenade,
// slot, buyKey) and main.js clears them after every step.

export function createInput(state, canvas, onLockChange) {
  const input = state.input;
  const keys = new Set();

  function refreshHeld() {
    input.forward = keys.has('KeyW') || keys.has('ArrowUp');
    input.back = keys.has('KeyS') || keys.has('ArrowDown');
    input.left = keys.has('KeyA') || keys.has('ArrowLeft');
    input.right = keys.has('KeyD') || keys.has('ArrowRight');
    input.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    refreshHeld();
    if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    if (e.code === 'KeyR') input.reload = true;
    if (e.code === 'KeyB') input.buy = true;
    if (e.code === 'KeyE') input.use = true;
    if (e.code === 'KeyG') input.grenade = true;
    if (e.code === 'KeyM') state.muted = !state.muted;
    if (e.code === 'Digit1') input.slot = 1;
    if (e.code === 'Digit2') input.slot = 2;
    if (e.code === 'Digit3') input.slot = 3;
    if (e.code === 'Digit4') input.slot = 4;
    if (e.code === 'Digit5') input.buyKey = 5;
    if (state.buyOpen) {
      if (e.code === 'Digit1') input.buyKey = 1;
      if (e.code === 'Digit2') input.buyKey = 2;
      if (e.code === 'Digit3') input.buyKey = 3;
      if (e.code === 'Digit4') input.buyKey = 4;
    }
    if (e.code === 'Escape' && state.buyOpen) state.buyOpen = false;
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    refreshHeld();
    if (e.code === 'Space') input.jump = false;
  }

  function onMouseMove(e) {
    if (!state.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  }

  function onMouseDown(e) {
    if (!state.locked) return;
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
  }

  function onMouseUp(e) {
    if (e.button === 0) input.fire = false;
  }

  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      input.fire = false;
      input.lookDX = 0;
      input.lookDY = 0;
    }
    onLockChange(state.locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  return {
    requestLock() {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    clearTransient() {
      input.firePressed = false;
      input.reload = false;
      input.buy = false;
      input.use = false;
      input.grenade = false;
      input.slot = 0;
      input.buyKey = 0;
      input.jump = false;
    },
  };
}
