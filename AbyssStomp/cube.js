let nextId = 1;

export class Cube {
  constructor(x, y, size, hue) {
    this.id = nextId++;
    this.x = x; // center x
    this.y = y; // center y
    this.size = size;
    this.vx = 0;
    this.vy = 0;
    this.rot = 0;
    this.vr = 0;
    this.hue = hue;
    this.squash = 0; // 0..1 landing impact, decays
    this.kicked = false;
    this.dead = false;
  }

  get half() {
    return this.size / 2;
  }

  get left() {
    return this.x - this.half;
  }

  get right() {
    return this.x + this.half;
  }

  get top() {
    return this.y - this.half;
  }

  get bottom() {
    return this.y + this.half;
  }

  contains(px, py) {
    return px >= this.left && px <= this.right && py >= this.top && py <= this.bottom;
  }
}
