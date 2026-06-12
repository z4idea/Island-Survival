// @author: zhjj
// 键盘 / 鼠标输入管理：按住状态 + 单帧按下事件

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseLeft = false;
  mouseRight = false;
  wheel = 0; // 本帧滚轮方向累积：>0 向下，<0 向上
  private mousePressedLeft = false;
  private mousePressedRight = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener('mousedown', (e) => {
      // 仅响应画布区域（按钮等 UI 不触发攻击）
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
      if (e.button === 0) {
        this.mouseLeft = true;
        this.mousePressedLeft = true;
      } else if (e.button === 2) {
        this.mouseRight = true;
        this.mousePressedRight = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeft = false;
      else if (e.button === 2) this.mouseRight = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasClickLeft(): boolean {
    return this.mousePressedLeft;
  }

  wasClickRight(): boolean {
    return this.mousePressedRight;
  }

  /** 每帧结束时清空单帧事件 */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressedLeft = false;
    this.mousePressedRight = false;
    this.wheel = 0;
  }
}
