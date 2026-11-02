import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const WEAPONS = ['Pistol', 'Shotgun', 'SMG', 'Rifle', 'Magnum'];
const SPAWNS = ['Test body', 'Wood block', 'Metal can', 'Rubber ball'];
const ORGANS = ['Brain', 'Heart', 'Lungs', 'Liver', 'Stomach', 'Spine', 'Arteries'];

const WALK_SPEED = 2.0;
const SNAP_ANGLE = Math.PI / 6;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

function labelTexture(title, detail = '', active = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = active ? '#c8efdb' : 'rgba(14,28,35,.92)';
  ctx.strokeStyle = active ? '#e9fff1' : '#9fd9c8'; ctx.lineWidth = 5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(5, 5, 502, 150, 24); else ctx.rect(5, 5, 502, 150);
  ctx.fill(); ctx.stroke();
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

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.()); else m?.dispose?.();
  });
}

export class VRLayer {
  /**
   * options.moveRig (default true): the layer moves/turns its own dolly (`this.rig`) from the thumbsticks.
   * Pass moveRig:false if your onMove callback already moves the player and you only want the rest.
   */
  constructor(renderer, camera, scene, { onWeapon, onFire, onSpawn, onMove, getMedical, moveRig = true } = {}) {
    this.renderer = renderer; this.camera = camera; this.scene = scene;
    this.onWeapon = onWeapon; this.onFire = onFire; this.onSpawn = onSpawn; this.onMove = onMove; this.getMedical = getMedical;
    this.moveRig = moveRig;
    this.session = null; this.menu = null; this.menuKind = ''; this.controllers = [];
    this.prevButtons = new WeakMap(); this.raycaster = new THREE.Raycaster(); this.aim = new THREE.Vector3();
    this.snapReady = true; this.bodyYaw = 0;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');

    // WebXR rewrites the camera's local pose every frame, so anything that moves or turns the player
    // (and everything that must follow the player: controllers, hands) has to live under a dolly group.
    // Setting camera.position directly does nothing in a headset.
    this.rig = new THREE.Group(); this.rig.name = 'xr-rig';
    this.scene.add(this.rig);
    this.rig.add(this.camera); // also guarantees the camera (and the HUD parented to it) is in the scene graph

    const button = VRButton.createButton(renderer);
    button.id = 'enter-vr'; document.body.appendChild(button);
    this.button = button;
    this.makeMenus(); this.makeControllers();
    renderer.xr.addEventListener('sessionstart', () => {
      this.session = renderer.xr.getSession(); this.button?.setAttribute('aria-label', 'VR session active');
      document.body.classList.add('vr-active');
      this.desktopPose = { p: this.camera.position.clone(), q: this.camera.quaternion.clone() };
      this.rig.position.set(0, 0, 3); this.rig.rotation.set(0, 0, 0); this.bodyYaw = 0;
      this.session.addEventListener('inputsourceschange', () => this.prevButtons = new WeakMap());
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.session = null; document.body.classList.remove('vr-active'); this.closeMenu();
      this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0);
      if (this.desktopPose) { this.camera.position.copy(this.desktopPose.p); this.camera.quaternion.copy(this.desktopPose.q); }
      this.torso.visible = false; this.armMeshes.forEach((a) => { a.visible = false; });
    });
  }

  makeMenus() {
    this.hud = new THREE.Group(); this.hud.position.set(0, -.02, -1.05); this.camera.add(this.hud);
    // Torso follows head *yaw* only (it used to be parented to the camera, so it swung around when looking up/down,
    // and showed up as a floating blob on the desktop view).
    this.torso = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshStandardMaterial({ color: 0x344c4b, roughness: .78 }));
    this.torso.scale.set(.22, .34, .13); this.torso.visible = false; this.scene.add(this.torso);
    this.armMeshes = [0, 1].map(() => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.045, .065, 1, 12), new THREE.MeshStandardMaterial({ color: 0x485d59, roughness: .76 }));
      mesh.visible = false; this.scene.add(mesh); return mesh;
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
      controller.addEventListener('connected', (e) => { controller.userData.source = e.data; });
      controller.addEventListener('disconnected', () => { controller.userData.source = null; });
      controller.addEventListener('selectstart', () => this.pressTrigger(controller));
      // Parent to the dolly so they follow locomotion and snap turns.
      this.rig.add(controller, grip); this.controllers.push(controller);
    }
  }

  haptic(controller, strength = .6, ms = 40) {
    try { controller.userData.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch { /* not supported */ }
  }

  pressTrigger(controller) {
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    if (this.menuKind) {
      this.hud.updateWorldMatrix(true, true);
      this.raycaster.set(origin, direction);
      const roots = this.menuKind === 'weapon' ? this.weaponMenu : this.menuKind === 'spawn' ? this.spawnMenu : this.medicalMenu;
      const hit = this.raycaster.intersectObjects(roots.children, true).find((entry) => entry.object.userData.menuAction);
      if (hit) { this.haptic(controller, .3, 20); this.activate(hit.object.userData.menuAction.id); }
      else this.closeMenu(); // clicking empty space dismisses the menu
      return;
    }
    if (controller.userData.hand === 1) {
      this.haptic(controller, .9, 45);
      this.onFire?.({ origin, direction });
    }
  }

  activate(id) {
    const [kind, value] = id.split(':');
    if (value === 'close') { this.closeMenu(); return; }
    if (kind === 'weapon') { this.setWeapon(value.toLowerCase()); this.onWeapon?.(value.toLowerCase()); }
    if (kind === 'spawn') this.onSpawn?.(value);
    this.closeMenu();
  }

  open(kind) {
    this.closeMenu(); this.menuKind = kind;
    (kind === 'weapon' ? this.weaponMenu : kind === 'spawn' ? this.spawnMenu : this.medicalMenu).visible = true;
  }
  toggle(kind) { if (this.menuKind === kind) this.closeMenu(); else this.open(kind); }
  closeMenu() { this.menuKind = ''; this.weaponMenu.visible = false; this.spawnMenu.visible = false; this.medicalMenu.visible = false; }

  setWeapon(name) {
    this.selectedWeapon = name;
    if (!this.weaponGrip) return;
    if (this.heldWeapon) { this.heldWeapon.removeFromParent(); disposeTree(this.heldWeapon); }
    this.heldWeapon = weaponModel(name); this.heldWeapon.position.set(0, -.04, -.12); this.heldWeapon.rotation.x = -.08; this.weaponGrip.add(this.heldWeapon);
  }

  pressed(gamepad, indexes) { return indexes.some((i) => gamepad?.buttons?.[i]?.pressed); }

  /** Turn the dolly around the player's head so snap turning doesn't swing them around the origin. */
  turnRig(angle) {
    this.rig.updateMatrixWorld(true);
    const before = this.camera.getWorldPosition(_v).clone();
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld(true);
    const after = this.camera.getWorldPosition(_v2);
    this.rig.position.x += before.x - after.x;
    this.rig.position.z += before.z - after.z;
  }

  headYaw() {
    this.camera.getWorldQuaternion(_q);
    const f = _v.set(0, 0, -1).applyQuaternion(_q); f.y = 0;
    if (f.lengthSq() < 1e-4) { // looking straight up/down: fall back to the head's up vector
      f.set(0, 1, 0).applyQuaternion(_q); f.y = 0;
      if (f.lengthSq() < 1e-6) return this.bodyYaw;
      f.negate();
    }
    return Math.atan2(-f.x, -f.z);
  }

  update(dt) {
    if (!this.session) return new THREE.Vector3();
    const move = new THREE.Vector3();
    const yaw = this.headYaw();
    // smooth the body yaw so the torso/arms don't jitter with every head wobble
    let d = yaw - this.bodyYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bodyYaw += d * Math.min(1, dt * 6);

    for (const source of [...this.session.inputSources]) {
      const pad = source.gamepad; if (!pad) continue;
      const buttons = pad.buttons || [];
      const before = this.prevButtons.get(source) || [];
      const rising = (indexes) => indexes.some((i) => !!buttons[i]?.pressed && !before[i]);
      const left = source.handedness === 'left';
      const axes = pad.axes || [];
      const x = axes.length >= 4 ? axes[2] : axes[0] || 0;
      const y = axes.length >= 4 ? axes[3] : axes[1] || 0;
      if (left) {
        const dead = .16;
        if (Math.abs(x) > dead || Math.abs(y) > dead) {
          const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
          move.addScaledVector(right, x).addScaledVector(forward, -y);
        }
        if (rising([3])) this.toggle('medical');
      } else if (source.handedness === 'right') {
        if (this.moveRig) { // snap turn
          if (Math.abs(x) < .35) this.snapReady = true;
          else if (this.snapReady && Math.abs(x) > .75) { this.snapReady = false; this.turnRig(-Math.sign(x) * SNAP_ANGLE); }
        }
        if (rising([4])) this.toggle('weapon');
        if (rising([5])) this.toggle('spawn');
      }
      this.prevButtons.set(source, buttons.map((button) => !!button.pressed));
    }
    if (move.lengthSq() > 1) move.normalize();
    if (this.moveRig && move.lengthSq() > 0) this.rig.position.addScaledVector(move, WALK_SPEED * dt);

    // Body follows the head position, upright
    const head = this.camera.getWorldPosition(_v).clone();
    this.torso.position.set(head.x, head.y - .49, head.z).addScaledVector(_v2.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw)), -.06); // a little behind the head
    this.torso.rotation.set(0, this.bodyYaw, 0);
    this.torso.visible = true;

    const sin = Math.sin(this.bodyYaw), cos = Math.cos(this.bodyYaw);
    this.controllers.forEach((controller, i) => {
      const side = i === 0 ? -1 : 1;
      // shoulder offset (side*.2, -.34, 0) rotated by body yaw only
      const ox = side * .2, oz = 0;
      const shoulder = new THREE.Vector3(head.x + ox * cos + oz * sin, head.y - .34, head.z - ox * sin + oz * cos);
      const hand = controller.getWorldPosition(new THREE.Vector3());
      const delta = hand.sub(shoulder);
      const arm = this.armMeshes[i];
      const len = delta.length();
      arm.visible = controller.visible && len > 1e-4; // untracked controllers used to drag an arm to the world origin
      if (!arm.visible) return;
      arm.position.copy(shoulder).addScaledVector(delta, .5);
      arm.quaternion.setFromUnitVectors(UP, delta.divideScalar(len));
      arm.scale.y = Math.max(.12, len);
    });
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
