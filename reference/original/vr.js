import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const WEAPONS = ['Pistol', 'Shotgun', 'SMG', 'Rifle', 'Magnum'];
const SPAWNS = ['Test body', 'Wood block', 'Metal can', 'Rubber ball'];
const ORGANS = ['Brain', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Spine', 'Arteries'];

function labelTexture(title, detail = '', active = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = active ? '#c8efdb' : 'rgba(14,28,35,.92)';
  ctx.strokeStyle = active ? '#e9fff1' : '#9fd9c8'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(5, 5, 502, 150, 24); ctx.fill(); ctx.stroke();
  ctx.fillStyle = active ? '#153b40' : '#f0faf7';
  ctx.font = '700 37px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, detail ? 60 : 80);
  if (detail) { ctx.fillStyle = active ? '#32635a' : '#9dc4bb'; ctx.font = '500 23px system-ui'; ctx.fillText(detail, 256, 112); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function weaponModel(kind = 'pistol') {
  const root = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x202a30, metalness: .7, roughness: .35 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x78878a, metalness: .82, roughness: .25 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x293d39, roughness: .8 });
  const long = kind === 'shotgun' || kind === 'rifle' || kind === 'smg';
  const barrelLength = kind === 'shotgun' ? .52 : kind === 'rifle' ? .48 : kind === 'smg' ? .36 : kind === 'magnum' ? .34 : .28;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, barrelLength, 12), steel);
  barrel.rotation.x = Math.PI / 2; barrel.position.z = -barrelLength * .38; root.add(barrel);
  const body = new THREE.Mesh(new THREE.BoxGeometry(kind === 'shotgun' ? .14 : .11, .085, long ? .25 : .18), dark); body.position.z = .02; root.add(body);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(.07, .16, .075), grip); handle.position.set(0, -.1, .065); handle.rotation.x = -.18; root.add(handle);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(.035, .025, .07), steel); sight.position.set(0, .054, -.035); root.add(sight);
  root.scale.setScalar(.85);
  return root;
}

export class VRLayer {
  constructor(renderer, camera, scene, { onWeapon, onFire, onSpawn, onMove, getMedical }) {
    this.renderer = renderer; this.camera = camera; this.scene = scene;
    this.onWeapon = onWeapon; this.onFire = onFire; this.onSpawn = onSpawn; this.onMove = onMove; this.getMedical = getMedical;
    this.session = null; this.menu = null; this.menuKind = ''; this.controllers = [];
    this.prevButtons = new WeakMap(); this.raycaster = new THREE.Raycaster(); this.aim = new THREE.Vector3();
    this.renderer.xr.enabled = true;
    const button = VRButton.createButton(renderer);
    button.id = 'enter-vr'; document.body.appendChild(button);
    this.button = button;
    this.makeMenus(); this.makeControllers();
    renderer.xr.addEventListener('sessionstart', () => {
      this.session = renderer.xr.getSession(); this.button?.setAttribute('aria-label', 'VR session active');
      document.body.classList.add('vr-active'); this.camera.position.set(0, 0, 3); this.camera.rotation.set(0, 0, 0);
    });
    renderer.xr.addEventListener('sessionend', () => { this.session = null; document.body.classList.remove('vr-active'); this.closeMenu(); });
  }

  makeMenus() {
    this.hud = new THREE.Group(); this.hud.position.set(0, -.02, -1.05); this.camera.add(this.hud);
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshStandardMaterial({ color: 0x344c4b, roughness: .78 }));
    torso.scale.set(.22, .34, .13); torso.position.set(0, -.49, -.19); this.camera.add(torso);
    this.armMeshes = [0, 1].map(() => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.045, .065, 1, 12), new THREE.MeshStandardMaterial({ color: 0x485d59, roughness: .76 }));
      this.scene.add(mesh); return mesh;
    });
    this.weaponMenu = new THREE.Group(); this.spawnMenu = new THREE.Group(); this.medicalMenu = new THREE.Group();
    this.hud.add(this.weaponMenu, this.spawnMenu, this.medicalMenu);
    this.makeRadial(this.weaponMenu, WEAPONS, 'weapon');
    this.makeRadial(this.spawnMenu, SPAWNS, 'spawn');
    this.medicalMenu.position.set(.38, 0, 0);
    const title = this.card('MEDICAL CHECK', 'Organ status', .48, .13, null, 'medical-title'); title.position.set(0, .42, 0);
    this.medicalMenu.add(title);
    this.organCards = ORGANS.map((name, i) => {
      const card = this.card(name, '', .44, .105, null, `organ:${name.toLowerCase()}`);
      card.position.set(0, .27 - i * .115, 0); this.medicalMenu.add(card); return card;
    });
    this.closeMenu();
  }

  card(title, detail, width, height, handler, id) {
    const material = new THREE.MeshBasicMaterial({ map: labelTexture(title, detail), transparent: true, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.userData.menuAction = { handler, id }; mesh.renderOrder = 20;
    return mesh;
  }

  makeRadial(group, labels, kind) {
    group.position.x = -.35;
    labels.forEach((name, i) => {
      const a = Math.PI / 2 + i * Math.PI * 2 / labels.length;
      const card = this.card(name, kind === 'weapon' ? 'Equip' : 'Spawn', .38, .12, null, `${kind}:${name}`);
      card.position.set(Math.cos(a) * .25, Math.sin(a) * .25, 0); group.add(card);
    });
    const center = this.card(kind === 'weapon' ? 'ARSENAL' : 'SPAWN', 'Point & trigger', .31, .11, null, `${kind}:close`);
    center.position.z = .008; group.add(center);
  }

  makeControllers() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.055, 16, 12), new THREE.MeshStandardMaterial({ color: i ? 0xd9eee5 : 0xb0c8d3, roughness: .55 }));
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.043, .052, .12, 16), new THREE.MeshStandardMaterial({ color: 0x24383d, metalness: .35, roughness: .4 }));
      cuff.rotation.x = Math.PI / 2; cuff.position.z = -.04; hand.add(cuff); grip.add(hand);
      if (i === 1) { this.weaponGrip = grip; this.setWeapon('pistol'); }
      controller.userData.hand = i;
      controller.addEventListener('selectstart', () => this.pressTrigger(controller));
      this.scene.add(controller, grip); this.controllers.push(controller);
    }
  }

  pressTrigger(controller) {
    if (this.menuKind) {
      this.raycaster.set(controller.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize());
      const roots = this.menuKind === 'weapon' ? this.weaponMenu : this.menuKind === 'spawn' ? this.spawnMenu : this.medicalMenu;
      const hit = this.raycaster.intersectObjects(roots.children, true).find((entry) => entry.object.userData.menuAction);
      if (hit) this.activate(hit.object.userData.menuAction.id);
      return;
    }
    if (controller.userData.hand === 1) {
      this.onFire?.({
        origin: controller.getWorldPosition(new THREE.Vector3()),
        direction: new THREE.Vector3(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize(),
      });
    }
  }

  activate(id) {
    const [kind, value] = id.split(':');
    if (value === 'close') { this.closeMenu(); return; }
    if (kind === 'weapon') this.setWeapon(value.toLowerCase());
    if (kind === 'weapon') this.onWeapon?.(value.toLowerCase());
    if (kind === 'spawn') this.onSpawn?.(value);
    this.closeMenu();
  }

  open(kind) {
    this.closeMenu(); this.menuKind = kind;
    (kind === 'weapon' ? this.weaponMenu : kind === 'spawn' ? this.spawnMenu : this.medicalMenu).visible = true;
  }
  closeMenu() { this.menuKind = ''; this.weaponMenu.visible = false; this.spawnMenu.visible = false; this.medicalMenu.visible = false; }

  setWeapon(name) {
    this.selectedWeapon = name;
    if (!this.weaponGrip) return;
    this.heldWeapon?.removeFromParent();
    this.heldWeapon = weaponModel(name); this.heldWeapon.position.set(0, -.04, -.12); this.heldWeapon.rotation.x = -.08; this.weaponGrip.add(this.heldWeapon);
  }

  pressed(gamepad, indexes) { return indexes.some((i) => gamepad?.buttons?.[i]?.pressed); }

  update(dt) {
    if (!this.session) return new THREE.Vector3();
    let move = new THREE.Vector3();
    const sources = [...this.session.inputSources];
    for (const source of sources) {
      const pad = source.gamepad; if (!pad) continue;
      const buttons = pad.buttons || [];
      const before = this.prevButtons.get(source) || [];
      const rising = (indexes) => indexes.some((i) => !!buttons[i]?.pressed && !before[i]);
      const left = source.handedness === 'left';
      const axes = pad.axes || [];
      if (left) {
        const x = axes.length >= 4 ? axes[2] : axes[0] || 0;
        const y = axes.length >= 4 ? axes[3] : axes[1] || 0;
        const dead = .16;
        if (Math.abs(x) > dead || Math.abs(y) > dead) {
          const yaw = new THREE.Euler().setFromQuaternion(this.renderer.xr.getCamera().quaternion, 'YXZ').y;
          const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          move.addScaledVector(right, x).addScaledVector(forward, -y);
        }
        if (rising([3])) this.open('medical');
      } else {
        if (rising([4])) this.open('weapon');
        if (rising([5])) this.open('spawn');
      }
      this.prevButtons.set(source, buttons.map((button) => !!button.pressed));
    }
    if (move.lengthSq() > 1) move.normalize();
    this.controllers.forEach((controller, i) => {
      const side = i === 0 ? -1 : 1;
      const shoulder = this.camera.localToWorld(new THREE.Vector3(side * .2, -.34, -.17));
      const hand = controller.getWorldPosition(new THREE.Vector3());
      const delta = hand.sub(shoulder);
      const arm = this.armMeshes[i];
      arm.position.copy(shoulder).addScaledVector(delta, .5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
      arm.scale.y = Math.max(.12, delta.length());
      arm.visible = true;
    });
    if (this.heldWeapon) this.heldWeapon.visible = true;
    if (this.menuKind === 'medical') this.refreshMedical();
    this.onMove?.(move, dt);
    return move;
  }

  refreshMedical() {
    const status = this.getMedical?.() || {};
    this.organCards.forEach((card) => {
      const organ = card.userData.menuAction.id.split(':')[1];
      const value = status[organ] || 'OK';
      if (card.userData.currentStatus === value) return;
      card.userData.currentStatus = value;
      card.material.map.dispose(); card.material.map = labelTexture(organ[0].toUpperCase() + organ.slice(1), value.toUpperCase()); card.material.map.needsUpdate = true;
    });
  }
}
