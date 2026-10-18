const WALK_IMAGE = new URL('./assets/komugi-pomeranian-walk-v1.png', import.meta.url).href;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function roomBounds(width, height, dogSize) {
  const margin = Math.min(width / 2, Math.max(dogSize * .34 + 18, width * .14));
  const front = Math.min(height * .4, Math.max(190, Math.min(210, height * .24)));
  const back = Math.max(front, height * .44);
  return { left: margin, right: Math.max(margin, width - margin), front, back };
}

export function stepToward(position, target, distance) {
  const dx = target.x - position.x, dy = target.y - position.y, remaining = Math.hypot(dx, dy);
  if (remaining <= distance || remaining < .5) return { ...target, arrived: true };
  return { x: position.x + dx / remaining * distance, y: position.y + dy / remaining * distance, arrived: false };
}

export function createRoomMotion(dogs) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const walkers = [...dogs].map(dog => new RoomWalker(dog, () => preference.matches));
  const image = new Image();
  image.onload = () => walkers.forEach(walker => { walker.ready = true; walker.resume(); });
  image.onerror = () => walkers.forEach(walker => walker.unavailable());
  image.src = WALK_IMAGE;
  const visibility = () => walkers.forEach(walker => walker.resume());
  const reduced = () => walkers.forEach(walker => walker.preferenceChanged());
  document.addEventListener('visibilitychange', visibility);
  preference.addEventListener('change', reduced);
  return {
    refresh: () => walkers.forEach(walker => walker.measure()),
    greet: () => walkers.forEach(walker => walker.comeHere(true)),
    destroy() {
      document.removeEventListener('visibilitychange', visibility);
      preference.removeEventListener('change', reduced);
      walkers.forEach(walker => walker.destroy());
    }
  };
}

class RoomWalker {
  constructor(dog, reduced) {
    this.dog = dog;
    this.scene = dog.closest('.room-scene');
    this.scene.classList.add('is-roaming-room');
    this.world = this.scene.classList.contains('room-scene--world');
    this.scene.querySelectorAll('.room-window,.room-spark,.room-floor,.floor-rug').forEach(el => el.setAttribute('aria-hidden', 'true'));
    this.reduced = reduced;
    this.position = null;
    this.target = null;
    this.visible = false;
    this.ready = false;
    this.paused = false;
    this.frame = 0;
    this.timer = 0;
    this.markerTimer = 0;
    this.greetTimer = 0;
    this.lastTime = 0;
    this.arrival = 'rest';
    dog.classList.add('can-roam');
    dog.dataset.activity = 'resting';
    const artwork = document.createElement('span');
    artwork.className = 'dog-walk-art';
    dog.append(artwork);
    this.scene.setAttribute('role', 'group');
    this.controls = document.createElement('div');
    this.controls.className = 'room-controls';
    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.className = 'roam-toggle';
    this.pauseButton.setAttribute('aria-pressed', 'false');
    this.callButton = document.createElement('button');
    this.callButton.type = 'button';
    this.callButton.className = 'call-companion';
    this.callButton.textContent = this.world ? 'おいで ♡' : 'こっちにおいで ♡';
    this.callButton.setAttribute('aria-label', 'こむぎを呼ぶ');
    this.controls.append(this.pauseButton, this.callButton);
    this.marker = document.createElement('span');
    this.marker.className = 'floor-target';
    this.marker.setAttribute('aria-hidden', 'true');
    this.scene.append(this.controls, this.marker);
    this.note = document.createElement('p');
    this.note.className = 'room-roam-note';
    this.scene.after(this.note);
    this.onPause = () => {
      this.paused = !this.paused;
      this.updateControls();
      if (this.paused) this.stop(); else this.resume();
    };
    this.onCall = () => this.comeHere();
    this.onFloor = event => {
      if (event.target.closest('button') || event.button !== 0) return;
      const rect = this.scene.getBoundingClientRect();
      if (event.clientY - rect.top < rect.height * .48) return;
      this.measure();
      const point = this.constrain({ x: event.clientX - rect.left, y: rect.bottom - event.clientY });
      this.marker.style.left = point.x + 'px';
      this.marker.style.bottom = point.y + 'px';
      this.marker.classList.remove('show');
      void this.marker.offsetWidth;
      this.marker.classList.add('show');
      clearTimeout(this.markerTimer);
      this.markerTimer = setTimeout(() => this.marker.classList.remove('show'), 900);
      this.walkTo(point, 'greet');
    };
    this.pauseButton.addEventListener('click', this.onPause);
    this.callButton.addEventListener('click', this.onCall);
    this.scene.addEventListener('pointerup', this.onFloor);
    this.resize = new ResizeObserver(() => this.measure());
    this.resize.observe(this.scene);
    this.observer = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      this.resume();
    }, { threshold: .1 });
    this.observer.observe(this.scene);
    this.measure();
    this.updateControls();
  }

  get active() { return this.visible && !document.hidden && !this.scene.closest('[hidden]'); }

  measure() {
    const width = this.scene.clientWidth, height = this.scene.clientHeight;
    if (!width || !height) return;
    this.bounds = roomBounds(width, height, parseFloat(getComputedStyle(this.dog).getPropertyValue('--dog-size')) || 260);
    this.position = this.constrain(this.position || { x: width * .5, y: (this.bounds.front + this.bounds.back) * .5 });
    if (this.target) this.target = this.constrain(this.target);
    this.paint();
  }

  constrain(point) {
    return this.bounds ? { x: clamp(point.x, this.bounds.left, this.bounds.right), y: clamp(point.y, this.bounds.front, this.bounds.back) } : point;
  }

  paint() {
    if (!this.position || !this.bounds) return;
    const depth = (this.position.y - this.bounds.front) / Math.max(1, this.bounds.back - this.bounds.front);
    this.dog.style.left = this.position.x.toFixed(2) + 'px';
    this.dog.style.bottom = 'calc(' + this.position.y.toFixed(2) + 'px - var(--dog-size) * var(--paw-inset))';
    this.dog.style.scale = (.98 - depth * .16).toFixed(3);
    this.dog.style.zIndex = this.position.y < this.bounds.front + 35 ? '6' : '4';
  }

  updateControls() {
    const resting = this.paused || this.reduced();
    this.pauseButton.textContent = this.world ? (resting ? '▷' : 'Ⅱ') : (resting ? 'おやすみ中 ▷' : 'おさんぽ中 Ⅱ');
    this.pauseButton.setAttribute('aria-label', resting ? 'おさんぽを再開' : 'おさんぽをおやすみ');
    this.pauseButton.setAttribute('aria-pressed', String(resting));
    this.pauseButton.disabled = this.reduced() || this.failed;
    this.note.textContent = this.reduced() ? 'こむぎを呼ぶと、そばでひと休み。' : '床をタップすると、そこまでおさんぽ。';
  }

  stop() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.frame = 0;
    this.timer = 0;
    this.target = null;
    this.dog.classList.remove('is-walking');
    this.dog.dataset.activity = 'resting';
    this.scene.classList.add('roam-resting');
    this.paint();
  }

  resume() {
    if (!this.active || this.reduced() || this.paused || !this.ready) { this.stop(); return; }
    this.scene.classList.remove('roam-resting');
    if (this.frame || this.timer) return;
    this.schedule(1200);
  }

  schedule(delay = 2400 + Math.random() * 2800) {
    clearTimeout(this.timer);
    if (!this.active || this.reduced() || this.paused || !this.ready) return;
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.measure();
      const middle = (this.bounds.left + this.bounds.right) / 2;
      const span=this.bounds.right-this.bounds.left;
      const side = this.position.x < middle ? this.bounds.right-span*Math.random()*.18 : this.bounds.left+span*Math.random()*.18;
      this.walkTo({ x: side, y: this.bounds.front + Math.random() * (this.bounds.back - this.bounds.front) });
    }, delay);
  }

  walkTo(point, arrival = 'rest') {
    this.stop();
    this.measure();
    this.target = this.constrain(point);
    this.arrival = arrival;
    if (!this.active || !this.ready || this.reduced() || this.paused) {
      if (this.active) { this.position = this.target; this.paint(); }
      this.finish();
      return;
    }
    if (Math.hypot(this.target.x - this.position.x, this.target.y - this.position.y) < 3) { this.finish(); return; }
    this.dog.classList.remove('greet');
    this.dog.style.setProperty('--walk-facing', this.target.x >= this.position.x ? '1' : '-1');
    this.dog.classList.add('is-walking');
    this.dog.dataset.activity = arrival === 'greet' ? 'approaching' : 'walking';
    this.scene.classList.remove('roam-resting');
    this.lastTime = performance.now();
    const tick = now => {
      if (!this.active || this.paused || this.reduced()) { this.stop(); return; }
      const dt = Math.min((now - this.lastTime) / 1000, .06);
      this.lastTime = now;
      const pace=Math.min(76,Math.max(32,this.scene.clientWidth*.075));
      const speed = this.arrival === 'greet' ? pace*1.45 : this.dog.classList.contains('feeling-lonely') ? pace*.68 : pace;
      const next = stepToward(this.position, this.target, speed * dt);
      this.position = { x: next.x, y: next.y };
      this.paint();
      if (next.arrived) this.finish(); else this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  finish() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.target = null;
    this.dog.classList.remove('is-walking');
    this.dog.dataset.activity = 'resting';
    this.paint();
    if (this.arrival === 'greet' && this.active) {
      this.dog.classList.remove('greet');
      void this.dog.offsetWidth;
      this.dog.classList.add('greet');
      clearTimeout(this.greetTimer);
      this.greetTimer = setTimeout(() => this.dog.classList.remove('greet'), 1100);
    }
    this.schedule(this.arrival === 'greet' ? 6500 : undefined);
  }

  comeHere(fromPet = false) {
    this.measure();
    if (!this.bounds) return;
    const center = (this.bounds.left + this.bounds.right) / 2;
    if (!this.active) {
      if (fromPet) { this.position = this.constrain({ x: center, y: this.bounds.front }); this.paint(); }
      return;
    }
    this.walkTo({ x: center, y: this.bounds.front }, 'greet');
  }

  preferenceChanged() { this.stop(); this.updateControls(); this.resume(); }

  unavailable() {
    this.failed = true;
    this.stop();
    this.pauseButton.textContent = 'ひと休み中';
    this.pauseButton.disabled = true;
    this.note.textContent = 'こむぎと、のんびりひと休み。';
  }

  destroy() {
    this.stop();
    clearTimeout(this.markerTimer);
    clearTimeout(this.greetTimer);
    this.observer.disconnect();
    this.resize.disconnect();
    this.pauseButton.removeEventListener('click', this.onPause);
    this.callButton.removeEventListener('click', this.onCall);
    this.scene.removeEventListener('pointerup', this.onFloor);
  }
}

