import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Material,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RENDER } from '../config';

export class SceneContext {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  private sun: DirectionalLight;
  private size = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(RENDER.skyColor);
    this.scene.fog = new Fog(RENDER.skyColor, RENDER.fogNear, RENDER.fogFar);

    this.camera = new PerspectiveCamera(RENDER.cameraFov, 1, RENDER.cameraNear, RENDER.cameraFar);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = RENDER.cameraMinDistance;
    this.controls.maxDistance = RENDER.cameraMaxDistance;
    this.controls.maxPolarAngle = RENDER.cameraMaxPolarAngle;

    this.scene.add(new HemisphereLight(RENDER.hemiSkyColor, RENDER.hemiGroundColor, RENDER.hemiIntensity));
    this.sun = new DirectionalLight(RENDER.sunColor, RENDER.sunIntensity);
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Center camera and light on a (new) world. */
  frameWorld(size: number) {
    const first = this.size === 0;
    const changed = size !== this.size;
    this.size = size;
    const c = size / 2;
    const [dx, dy, dz] = RENDER.sunDirection;
    const dir = new Vector3(dx, dy, dz).normalize().multiplyScalar(size);
    this.sun.position.set(c + dir.x, dir.y, c + dir.z);
    this.sun.target.position.set(c, 0, c);
    const cam = this.sun.shadow.camera;
    const half = size * 0.75;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = size * 3;
    cam.updateProjectionMatrix();
    if (first || changed) {
      const d = size * RENDER.cameraStartDistanceFactor;
      const p = RENDER.cameraStartPolar;
      this.controls.target.set(c, 0, c);
      this.camera.position.set(c, d * Math.cos(p), c + d * Math.sin(p));
      this.controls.update();
    }
  }

  setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // Materials must recompile when the shadow map toggles.
    this.scene.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
