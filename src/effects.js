// YER TUTUCU: post-processing yok, doğrudan çizim. Gerçek efektler bunun yerini alacak.
export class Effects {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  update() {}

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {}
}
