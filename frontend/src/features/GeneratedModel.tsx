import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { request, type TaskBoard, type TaskEntry } from "../api";

export type GeneratedMesh = {
  asset_id: string;
  sha256: string;
  provider: string;
  fallback: boolean;
  textured: boolean;
};
type Grounding = {
  visible: boolean;
  bbox: [number, number, number, number] | null;
  label: string;
  confidence: number;
  explanation: string;
};
type Viewer = { reset: () => void; locate: () => Promise<void>; dispose: () => void };

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((value) => value.dispose());
  materials.forEach((value) => value.dispose());
  geometries.forEach((value) => value.dispose());
}

export default function GeneratedModel({ mesh, board, entry, photoIds }: {
  mesh: GeneratedMesh; board: TaskBoard; entry: TaskEntry; photoIds: string[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<Viewer | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    setReady(false);
    setMessage("");
    const container = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eeeae3");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setMessage("当前浏览器无法启动3D，请使用实拍参考和文字步骤。");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    container.append(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, 1, .01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = .5;
    controls.maxDistance = 12;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, .04);
    scene.environment = environment.texture;
    room.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight("#ffffff", "#a39b8d", 1.2));
    const light = new THREE.DirectionalLight("#fff5df", 2);
    light.position.set(4, 6, 3);
    scene.add(light);
    const group = new THREE.Group();
    scene.add(group);
    let model: THREE.Group | null = null;
    let pin: THREE.Object3D | null = null;
    let locating = false;
    const reset = () => {
      camera.position.set(2.3, 1.6, 3.4);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    reset();
    const resize = new ResizeObserver(() => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resize.observe(container);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

    async function locate() {
      if (disposed || !model || locating) return;
      locating = true;
      setBusy(true);
      setMessage("正在辨认当前视角中的操作处…");
      controls.enabled = false;
      if (pin) { scene.remove(pin); disposeTree(pin); pin = null; }
      // Pick using the exact camera and aspect that produced the submitted render.
      controls.update();
      camera.updateMatrixWorld(true);
      const captureCamera = camera.clone();
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);
      const encoded = renderer.domElement.toDataURL("image/jpeg", .9).split(",")[1];
      try {
        const answer = await request<Grounding>(`/tasks/${board.task.id}/diagram/locate`, "POST", {
          expected_version: board.task.version, step_id: entry.id,
          model_asset_id: mesh.asset_id, render_base64: encoded,
        });
        if (disposed) return;
        if (!answer.visible || !answer.bbox || answer.confidence < .65) {
          setMessage("当前视角未能可靠辨认操作处。可旋转到按键可见的位置后重新定位，或核对实拍。");
          return;
        }
        const [x1, y1, x2, y2] = answer.bbox;
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((x1 + x2) / 999 - 1, 1 - (y1 + y2) / 999), captureCamera);
        const hit = ray.intersectObject(model!, true).find((value) => value.object instanceof THREE.Mesh);
        if (!hit || !hit.face) {
          setMessage("识别位置未落到模型表面，请核对实拍。");
          return;
        }
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        const marker = new THREE.Group();
        const point = new THREE.Mesh(new THREE.SphereGeometry(.025, 16, 12),
          new THREE.MeshBasicMaterial({ color: "#e46832", depthTest: false }));
        point.position.copy(hit.point);
        point.renderOrder = 100;
        marker.add(point);
        const arrow = new THREE.ArrowHelper(normal.clone().negate(), hit.point.clone().addScaledVector(normal, .32), .28, "#e46832", .085, .065);
        marker.add(arrow);
        pin = marker;
        scene.add(marker);
        setMessage(`${answer.label}：橙色箭头为模型推测，请核对实物。`);
      } catch (error) {
        if (!disposed) setMessage((error as Error).message);
      } finally {
        locating = false;
        controls.enabled = true;
        if (!disposed) setBusy(false);
      }
    }

    view.current = { reset, locate, dispose: () => {
      disposed = true;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeTree(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    } };
    void new GLTFLoader().loadAsync(`/api/assets/${mesh.asset_id}`).then((gltf) => {
      if (disposed) { disposeTree(gltf.scene); return; }
      model = gltf.scene;
      group.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 2 / Math.max(size.x, size.y, size.z, .00001);
      group.scale.setScalar(scale);
      group.position.copy(center).multiplyScalar(-scale);
      scene.updateMatrixWorld(true);
      setReady(true);
      void locate();
    }).catch(() => { if (!disposed) setMessage("模型暂时无法打开，请使用实拍与文字步骤。"); });
    return () => { view.current?.dispose(); view.current = null; };
  }, [mesh.asset_id, mesh.sha256, board.task.id, board.task.version, entry.id]);

  return <>
    <div className="diagram-controls">
      <button className="soft-button" disabled={!ready || busy} onClick={() => void view.current?.locate()}>定位当前操作处</button>
      <button className="quiet-button" disabled={busy} onClick={() => view.current?.reset()}>看全貌</button>
      {!!photoIds.length && <button className="quiet-button" onClick={() => setPhoto(!photo)}>核对实拍</button>}
    </div>
    <div ref={host} className="teaching-stage" style={{ height: 440, overflow: "hidden" }} role="img" aria-label={`${entry.title}的可旋转3D外观模型`} />
    <p className="muted">{mesh.fallback ? "云端暂不可用，已使用本地外观模型（无纹理）。" : "已生成外观模型。"}拖动可旋转，滚轮可缩放。</p>
    {message && <p role="status">{message}</p>}
    {photo && photoIds.map((id) => <img key={id} src={`/api/assets/${id}`} alt="当前物品的实拍参考" style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }} />)}
  </>;
}
