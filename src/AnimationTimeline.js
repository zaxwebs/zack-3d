/** Scrollable clip ruler backed by the animation controller's actual clock. */
export class AnimationTimeline {
  constructor(controller) {
    this.controller = controller;
    this.element = document.querySelector('#timeline');
    this.play = document.querySelector('#timelinePlay');
    this.name = document.querySelector('#timelineName');
    this.time = document.querySelector('#timelineTime');
    this.scroll = document.querySelector('#timelineScroll');
    this.content = document.querySelector('#timelineContent');
    this.ruler = document.querySelector('#timelineRuler');
    this.clip = document.querySelector('#timelineClip');
    this.scrubber = document.querySelector('#timelineScrubber');
    this.zoomOut = document.querySelector('#timelineZoomOut');
    this.zoomIn = document.querySelector('#timelineZoomIn');
    this.pixelsPerSecond = 240;
    this.activeName = null;
    this.duration = 0;
    this.manualScrollUntil = 0;

    this.play.addEventListener('click', () => {
      controller.togglePlayback();
      this.update();
    });
    this.scrubber.addEventListener('input', () => {
      controller.seek(Number(this.scrubber.value));
      this.manualScrollUntil = performance.now() + 2000;
      this.update();
    });
    this.zoomOut.addEventListener('click', () => this.zoom(1 / 1.5));
    this.zoomIn.addEventListener('click', () => this.zoom(1.5));
    this.scroll.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) return;
      this.manualScrollUntil = performance.now() + 2000;
      if (this.scroll.scrollWidth > this.scroll.clientWidth) {
        event.preventDefault();
        this.scroll.scrollLeft += event.deltaX + event.deltaY;
      }
    }, { passive: false });
    this.scroll.addEventListener('pointerdown', () => { this.manualScrollUntil = performance.now() + 2000; });
    window.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
      if (!controller.activeAction) return;
      event.preventDefault();
      controller.togglePlayback();
      this.update();
    });
    new ResizeObserver(() => this.layout()).observe(this.scroll);
    this.update();
  }

  zoom(factor) {
    this.pixelsPerSecond = Math.max(80, Math.min(800, this.pixelsPerSecond * factor));
    this.layout();
    const x = this.duration ? this.controller.playback.time / this.duration * this.content.clientWidth : 0;
    this.scroll.scrollLeft = x - this.scroll.clientWidth / 2;
  }

  layout() {
    const width = Math.max(this.scroll.clientWidth, this.duration * this.pixelsPerSecond);
    this.content.style.width = `${width}px`;
    const scale = this.duration ? width / this.duration : this.pixelsPerSecond;
    this.content.style.setProperty('--tick-step', `${scale / 10}px`);
    this.ruler.replaceChildren();
    if (this.duration) {
      const interval = scale >= 320 ? 0.25 : scale >= 120 ? 0.5 : 1;
      const times = [];
      for (let time = 0; time < this.duration - interval * 0.4; time += interval) times.push(time);
      times.push(this.duration);
      for (const time of times) {
        const tick = document.createElement('span');
        tick.className = 'timeline-tick';
        tick.style.left = `${time / this.duration * 100}%`;
        tick.textContent = `${Number(time.toFixed(2))}s`;
        this.ruler.append(tick);
      }
    }
    this.zoomOut.disabled = !this.duration || this.pixelsPerSecond <= 80;
    this.zoomIn.disabled = !this.duration || this.pixelsPerSecond >= 800;
  }

  update() {
    const state = this.controller.playback;
    if (state.name !== this.activeName || state.duration !== this.duration) {
      this.activeName = state.name;
      this.duration = state.duration;
      this.element.dataset.ready = String(Boolean(state.duration));
      this.name.textContent = state.label;
      this.clip.textContent = state.duration ? state.label : 'Choose a mocap preset to scrub its motion';
      this.scrubber.max = String(state.duration);
      this.scrubber.disabled = this.play.disabled = !state.duration;
      this.scroll.scrollLeft = 0;
      this.layout();
    }
    this.play.textContent = state.playing ? 'Ⅱ Pause' : '▶ Play';
    this.play.setAttribute('aria-label', state.playing ? 'Pause animation' : 'Play animation');
    this.scrubber.value = String(state.time);
    this.scrubber.setAttribute('aria-valuetext', `${state.time.toFixed(2)} of ${state.duration.toFixed(2)} seconds`);
    this.time.value = `${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s`;
    if (state.playing && performance.now() > this.manualScrollUntil) {
      const x = state.time / state.duration * this.content.clientWidth;
      if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + this.scroll.clientWidth - 12) {
        this.scroll.scrollLeft = Math.max(0, x - this.scroll.clientWidth * 0.3);
      }
    }
  }
}
