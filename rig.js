import * as THREE from 'three';
import { Character, DIM } from './systems/character.js';
import { Ragdoll } from './systems/ragdoll.js';
import { orient, solveTwoBone } from './systems/ik.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const reflexEuler = new THREE.Euler(0, 0, 0, 'XZY');
const reflexQuat = new THREE.Quaternion();
const LOOKS = [
  { skin: 0xc58f73, hair: 0x211a18, top: 0x77716b, shorts: 0x343538, shoe: 0x242426 },
  { skin: 0xe0b08d, hair: 0x67432e, top: 0x4e7984, shorts: 0x343e4d, shoe: 0x282c32 },
  { skin: 0x9c654d, hair: 0x191513, top: 0x8a795c, shorts: 0x3b3433, shoe: 0x292629 },
];

export class Rig {
  constructor(scene, world, look = {}) {
    this.world = world;
    this.scene = scene;
    this.hero = new Character(scene, {
      sex: 'm', height: 1, build: 1, wardrobe: true, skin: 0xc99378, hair: 0x211916,
      top: 0x393638, shorts: 0x315d7c, shoe: 0x171619, hairStyle: 'short', sleeves: 'short', legs: 'long',
      ...look,
    });
    this.hero.reset(V(0, 0, 0), 0);
    this.hero.update(1 / 60, { move: V(), run: false, jump: false, camYaw: Math.PI });
    this.groups = { pelvis: this.hero.hips, spine: this.hero.spine, chest: this.hero.chest, head: this.hero.neck };
    for (const [i, side] of ['L', 'R'].entries()) {
      this.groups['thigh' + side] = this.hero.legs[i].thigh;
      this.groups['shin' + side] = this.hero.legs[i].shin;
      this.groups['foot' + side] = this.hero.legs[i].foot;
      this.groups['upper' + side] = this.hero.arms[i].upper;
      this.groups['fore' + side] = this.hero.arms[i].fore;
    }
    this.rd = new Ragdoll(world, this.hero.S, this.hero.kA, this.hero.kL);
    this.mode = 'anim';
    this.boundPose = false;
    this.boundTiesVisible = false;
    this.boundLines = [];
    this.boundCuffs = [];
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x49302d, roughness: 0.92 });
    const cuffGeo = new THREE.TorusGeometry(0.034, 0.006, 7, 20);
    const ankleCuffGeo = new THREE.TorusGeometry(0.05, 0.008, 7, 22);
    this.boundTieMat = tieMat;
    this.boundCuffGeo = cuffGeo;
    this.boundAnkleCuffGeo = ankleCuffGeo;
    for (const arm of this.hero.arms) {
      const cuff = new THREE.Mesh(cuffGeo, tieMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.visible = false;
      arm.hand.add(cuff);
      this.boundCuffs.push(cuff);
    }
    const ankleCuff = new THREE.Mesh(ankleCuffGeo, tieMat);
    ankleCuff.rotation.x = Math.PI / 2;
    ankleCuff.position.y = 0.025;
    ankleCuff.visible = false;
    this.hero.legs[0].foot.add(ankleCuff);
    this.boundCuffs.push(ankleCuff);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x442c2a, roughness: 0.96 });
    this.boundRopeMat = ropeMat;
    this.boundRopeGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 7, 1);
    for (let i = 0; i < 2; i++) {
      const rope = [];
      for (let j = 0; j < 4; j++) {
        const segment = new THREE.Mesh(this.boundRopeGeo, ropeMat);
        segment.visible = false;
        scene.add(segment);
        rope.push(segment);
      }
      this.boundLines.push(rope);
    }
    this.brain = { dead: false, hands: null, neuro: { ep: false, seizing: false, reset() {}, posture() {}, clearPosture() {}, fence() {}, agonal() {}, seize() { return 0; } } };
    this.fallAudio = null;
    this.contactClock = 0;
    this.impactSamples = new Map();
    this.capture();
  }

  capture() {
    this.hero.root.updateMatrixWorld(true);
    const pose = {};
    for (const [name, group] of Object.entries(this.groups)) {
      pose[name] = { pos: V(), quat: new THREE.Quaternion() };
      group.getWorldPosition(pose[name].pos);
      group.getWorldQuaternion(pose[name].quat);
    }
    this.pose = pose;
    return pose;
  }

  setBoundPose(enabled) {
    enabled = !!enabled;
    if (enabled === this.boundPose) return true;
    if (enabled) {
      if (this.brain.dead) return false;
      if (this.mode === 'ragdoll' && !this.returnToAnimation()) return false;
      const h = this.hero, position = h.pos.clone(), yaw = h.yaw;
      h.reset(position, yaw);
      this.boundPose = true;
      this.boundTiesVisible = true;
      this.boundCuffs.forEach((cuff) => { cuff.visible = true; });
      this.boundLines.forEach((line) => { line.visible = true; });
      this.updateBoundPose(0.35, Math.PI);
      return true;
    }
    this.boundPose = false;
    this.boundTiesVisible = false;
    this.boundCuffs.forEach((cuff) => { cuff.visible = false; });
    this.boundLines.forEach((line) => { line.visible = false; });
    const h = this.hero, position = h.pos.clone(), yaw = h.yaw;
    h.reset(position, yaw);
    h.update(1 / 60, { move: V(), run: false, jump: false, camYaw: Math.PI });
    return true;
  }

  updateBoundPose(dt, camYaw = Math.PI) {
    if (!this.boundPose) return;
    const h = this.hero;
    h.update(dt, { move: V(), run: false, jump: false, crouch: true, camYaw });
    // Lower the hips into a one-knee kneel and keep the torso upright.
    h.hips.position.y = h.D.HIP_Y * 0.45;
    h.hips.rotation.set(0.12, 0, 0);
    h.spine.rotation.set(0.04, 0, 0);
    h.chest.rotation.set(-0.03, 0, 0);
    h.neck.rotation.set(0.02, 0, 0);
    h.root.updateMatrixWorld(true);
    const footYaw = h.yaw;
    for (let i = 0; i < h.legs.length; i++) {
      const leg = h.legs[i], side = leg.side;
      const hip = h.hips.localToWorld(V(side * 0.088, -0.055, 0));
      const ankle = h.root.localToWorld(V(side * 0.12, 0.08, i === 0 ? -0.22 : 0.4));
      const poleAt = h.root.localToWorld(i === 0 ? V(-0.12, -0.9, -0.45) : V(0.34, -0.65, 0.16));
      const pole = poleAt.sub(hip).normalize();
      const knee = V(), end = V();
      solveTwoBone(hip, ankle, h.D.THIGH, h.D.SHIN, pole, knee, end);
      orient(leg.thigh, hip, knee, pole, true);
      orient(leg.shin, knee, end, pole, true);
      leg.foot.position.copy(end);
      leg.foot.quaternion.setFromEuler(new THREE.Euler(0, footYaw, 0));
    }
    const wristTargets = [];
    for (const arm of h.arms) {
      const shoulder = h.chest.localToWorld(V(arm.side * 0.185, 0.2, -0.015));
      const wrist = h.root.localToWorld(V(arm.side * 0.055, 0.73, -0.15));
      const poleAt = h.root.localToWorld(V(arm.side * 0.42, 0.66, -0.42));
      const pole = poleAt.sub(shoulder).normalize();
      const elbow = V(), hand = V();
      solveTwoBone(shoulder, wrist, h.D.UPPER_ARM, h.D.FOREARM, pole, elbow, hand);
      orient(arm.upper, shoulder, elbow, pole, true);
      orient(arm.fore, elbow, hand, pole, true);
      arm.hand.rotation.set(0, 0, 0);
      arm.fingers.forEach(([first, second], finger) => {
        first.rotation.set(0, 0, -(1.38 + finger * 0.045));
        second.rotation.set(0, 0, -(1.58 + finger * 0.04));
      });
      arm.thumb[0].rotation.set(-0.72, 0, -0.58);
      arm.thumb[1].rotation.z = -0.88;
      arm.hand.getWorldPosition(arm._boundWrist || (arm._boundWrist = V()));
      wristTargets.push(arm._boundWrist.clone());
    }
    h.root.updateMatrixWorld(true);
    if (this.boundTiesVisible) this.updateBoundTies(wristTargets);
  }

  updateBoundTies(wrists = null) {
    const h = this.hero;
    wrists ||= h.arms.map((arm) => arm.hand.getWorldPosition(V()));
    const back = V(0, 0, -0.045).applyQuaternion(h.root.quaternion);
    const leftAnkle = h.legs[0].foot.getWorldPosition(V());
    const rightCalf = h.legs[1].shin.localToWorld(V(0, -0.22, 0));
    const paths = [
      [wrists[0], wrists[1], back],
      [leftAnkle, rightCalf, back.clone().multiplyScalar(0.55)],
    ];
    for (let i = 0; i < paths.length; i++) {
      const [a, b, sag] = paths[i], points = [];
      for (let j = 0; j < 5; j++) {
        const t = j / 4;
        const p = a.clone().lerp(b, t).addScaledVector(sag, Math.sin(Math.PI * t));
        points.push(p);
      }
      for (let j = 0; j < 4; j++) {
        const segment = this.boundLines[i][j];
        const delta = points[j + 1].clone().sub(points[j]);
        segment.position.copy(points[j]).add(points[j + 1]).multiplyScalar(0.5);
        segment.quaternion.setFromUnitVectors(V(0, 1, 0), delta.clone().normalize());
        segment.scale.y = delta.length();
      }
    }
  }

  apply(pose) {
    const h = this.hero;
    h.root.position.set(0, 0, 0);
    h.root.quaternion.identity();
    const inv = new THREE.Quaternion();
    const setLocal = (obj, parent, name) => {
      inv.copy(pose[parent].quat).invert();
      obj.quaternion.copy(inv).multiply(pose[name].quat);
      obj.position.copy(pose[name].pos).sub(pose[parent].pos).applyQuaternion(inv).multiplyScalar(1 / h.S);
    };
    h.hips.position.copy(pose.pelvis.pos);
    h.hips.quaternion.copy(pose.pelvis.quat);
    setLocal(h.spine, 'pelvis', 'spine');
    setLocal(h.chest, 'spine', 'chest');
    setLocal(h.neck, 'chest', 'head');
    for (const name of ['thighL', 'shinL', 'footL', 'upperL', 'foreL', 'thighR', 'shinR', 'footR', 'upperR', 'foreR']) {
      this.groups[name].position.copy(pose[name].pos);
      this.groups[name].quaternion.copy(pose[name].quat);
    }
    const heldSides = new Set(this.woundHold?.hands.map((grip) => grip.side) || []);
    const handTime = this.handAnimTime || 0;
    const headshotFist = !!this.deathState?.headshot && !!this.deathState?.upright && this.brain.dead;
    h.arms.forEach((arm, index) => {
      const held = heldSides.has(arm.side > 0 ? 'L' : 'R');
      const pulse = 0.5 + 0.5 * Math.sin(handTime * 2.6 + index * 1.8);
      const curl = headshotFist ? 1.42 : held ? 1.32 : 0.1 + pulse * 0.2;
      arm.fingers.forEach(([first, second], finger) => {
        const twitch = headshotFist || held ? 0 : Math.sin(handTime * 4.1 + finger * 1.7 + index) * 0.035;
        first.rotation.z = -(curl + finger * 0.055 + twitch);
        second.rotation.z = -(curl * 1.18 + finger * 0.045 + twitch);
        first.rotation.x = twitch * 0.7;
        second.rotation.x = -twitch;
      });
      arm.thumb[0].rotation.set(-0.7 - curl * 0.08, 0, -0.35 - curl * 0.32);
      arm.thumb[1].rotation.z = -curl * 0.72;
      arm.hand.rotation.x = headshotFist ? 0 : 0.1 + Math.sin(handTime * 2.2 + index) * 0.035;
    });
    h.root.updateMatrixWorld(true);
    if (this.boundTiesVisible) this.updateBoundTies();
  }

  goRagdoll() {
    if (this.mode === 'ragdoll') return;
    this.boundPose = false;
    const pose = this.capture();
    this.rd.enable(pose, pose, 1 / 60);
    for (const p of this.rd.list) {
      if (!p.parent) continue;
      p.targetQ = new THREE.Quaternion().copy(pose[p.parent.name].quat).invert().multiply(pose[p.name].quat);
      p.balanceQ = p.targetQ.clone();
      if (p.kind === 'shin') p.balanceKnee = this.rd.angles(p.name).x;
      p.strength = 0;
    }
    this.mode = 'ragdoll';
    this.balanceState = { yaw: new THREE.Euler().setFromQuaternion(pose.pelvis.quat, 'YXZ').y, stress: 0.08, stunTimer: 0, stepCooldown: 0, push: V(), command: V(), run: false, reflexIn: 2 + Math.random() * 2.5, reflex: null, nextStepSide: 'L' };
    this.apply(this.rd.read({}));
    this.impactSamples.clear();
    for (const p of this.rd.list) {
      const v = p.body.linvel();
      this.impactSamples.set(p.name, { x: v.x, y: v.y, z: v.z, cooldown: 0 });
    }
  }

  woundPointLocal(part, point) {
    const group = this.groups[part];
    if (this.mode === 'anim' && group) {
      group.updateWorldMatrix(true, false);
      return group.worldToLocal(point.clone());
    }
    const body = this.rd.parts[part]?.body;
    if (!body) return null;
    const t = body.translation(), r = body.rotation();
    return point.clone().sub(V(t.x, t.y, t.z)).applyQuaternion(new THREE.Quaternion(-r.x, -r.y, -r.z, r.w));
  }

  startWoundHold(part, localPoint) {
    if (!localPoint || this.brain.dead) return;
    const woundedSide = part.endsWith('L') ? 'L' : part.endsWith('R') ? 'R' : null;
    this.woundHold = null;
    const canHold = (name) => !this.rd.parts['fore' + name]?.gone && (this.organs?.canHold(name === 'L' ? 0 : 1) ?? true);
    const preferred = woundedSide ? (woundedSide === 'L' ? 'R' : 'L') : localPoint.x >= 0 ? 'L' : 'R';
    const hands = [preferred, preferred === 'L' ? 'R' : 'L'].filter(canHold);
    if (!hands.length) return;
    if (!['pelvis', 'spine', 'chest'].includes(part) || hands.length < 2) hands.length = 1;
    this.woundHold = {
      part,
      localPoint,
      hands: hands.map((side, index) => ({ side, offset: hands.length > 1 ? (index === 0 ? -0.035 : 0.035) : 0 })),
    };
  }

  stagger(force, direction) {
    if (!this.balanceState) return;
    this.balanceState.stress = Math.min(1.5, this.balanceState.stress + Math.max(0.15, force / 18));
    this.balanceState.stunTimer = Math.max(this.balanceState.stunTimer || 0, 0.7 + Math.min(0.9, force * 0.035));
    this.balanceState.push.copy(direction).setY(0);
    if (this.balanceState.push.lengthSq() > 1e-5) this.balanceState.push.normalize();
  }

  updateBalance(dt) {
    const state = this.balanceState;
    if (!state) return;
    const rd = this.rd;
    if (this.brain.dead) {
      this.woundHold = null;
      if (!this.deathState) {
        this.deathState = {
          time: 0,
          twitches: new Set(),
          flailClock: 0,
          flailPhase: Math.random() * Math.PI * 2,
          headshot: !!this.headshotDeath,
          tbiBuckling: !!this.tbiBucklingDeath,
        };
        this.headshotDeath = false;
        this.tbiBucklingDeath = false;
        for (const p of rd.list) {
          if (!p.parent || !p.joint) continue;
          p.targetQ = rd.quat(p.parent.name).invert().multiply(rd.quat(p.name));
          if (p.kind === 'shin') p.target.x = rd.angles(p.name).x;
        }
        const pelvisUp = V(0, 1, 0).applyQuaternion(rd.quat('pelvis')).y;
        this.deathState.upright = pelvisUp > 0.7 && rd.pos('pelvis').y > 0.62;
        if (this.deathState.headshot && this.deathState.upright) {
          for (const side of ['L', 'R']) {
            rd.parts['upper' + side].targetQ.setFromEuler(new THREE.Euler(-0.48, 0, side === 'L' ? -0.18 : 0.18, 'XZY'));
            rd.parts['fore' + side].targetQ.setFromEuler(new THREE.Euler(-1.55, 0, 0, 'XZY'));
          }
        }
        if (this.deathState.tbiBuckling) {
          // Rare fatal TBI response: the legs brace rigidly as the torso folds forward.
          rd.parts.spine.targetQ.setFromEuler(new THREE.Euler(0.72, 0, 0, 'XZY'));
          rd.parts.chest.targetQ.setFromEuler(new THREE.Euler(0.58, 0, 0, 'XZY'));
        }
      }
      const death = this.deathState;
      death.time += dt;
      const stiffness = Math.exp(-Math.max(0, death.time - 2) / 4.8);
      for (const p of rd.list) {
        if (!p.parent || !p.joint) continue;
        p.strength = death.headshot ? 0 : p.broken ? 0.012 : Math.min(1, (p.kind === 'shin' || p.kind === 'thigh' ? 0.85 : 0.68) * stiffness);
        p.damping = death.headshot ? (death.upright ? 0.12 : 0.45) : 1.35;
      }
      if (death.headshot && death.upright && death.time < 0.42) {
        for (const name of ['upperL', 'foreL', 'upperR', 'foreR']) {
          const arm = rd.parts[name];
          if (arm?.joint && !arm.broken) {
            arm.strength = name.startsWith('fore') ? 0.9 : 0.78;
            arm.damping = 0.8;
          }
        }
      }
      if (death.tbiBuckling && death.time < 0.8) {
        const brace = Math.min(1, 0.72 + death.time * 0.7);
        for (const name of ['spine', 'chest']) {
          const joint = rd.parts[name];
          if (joint?.joint && !joint.broken) {
            joint.strength = brace;
            joint.damping = 1.1;
          }
        }
        for (const name of ['thighL', 'shinL', 'thighR', 'shinR']) {
          const leg = rd.parts[name];
          if (leg?.joint && !leg.broken) {
            leg.strength = 0.98;
            leg.damping = 1.2;
          }
        }
      }
      for (const [at, names] of death.headshot ? [] : [[0.2, ['upperL', 'thighR']], [0.52, ['foreR', 'shinL']], [0.9, ['upperR', 'thighL']]]) {
        if (death.time < at || death.twitches.has(at)) continue;
        death.twitches.add(at);
        for (const name of names) {
          const body = rd.parts[name]?.body;
          if (body) body.applyImpulse({ x: (Math.random() - 0.5) * 0.48, y: 0.22 + Math.random() * 0.18, z: (Math.random() - 0.5) * 0.48 }, true);
        }
      }
      const falling = rd.parts.pelvis.body.linvel().y < -1.1;
      death.flailClock -= dt;
      if (falling && death.time < 2.8 && death.flailClock <= 0) {
        death.flailClock = 0.16 + Math.random() * 0.12;
        death.flailPhase += 0.8 + Math.random() * 0.7;
        for (const [side, sign] of [['L', -1], ['R', 1]]) {
          const wave = Math.sin(death.flailPhase + (side === 'R' ? Math.PI : 0));
          const arm = rd.parts['upper' + side];
          const forearm = rd.parts['fore' + side];
          const thigh = rd.parts['thigh' + side];
          const shin = rd.parts['shin' + side];
          if (!death.headshot || death.time > 0.42) {
            if (arm?.body && !arm.gone) arm.body.applyImpulse({ x: sign * (0.12 + Math.abs(wave) * 0.12), y: 0.12 + wave * 0.1, z: wave * 0.18 }, true);
            if (forearm?.body && !forearm.gone) forearm.body.applyImpulse({ x: sign * (0.08 + Math.abs(wave) * 0.08), y: 0.1 - wave * 0.08, z: -wave * 0.16 }, true);
          }
          if (thigh?.body && !thigh.gone) thigh.body.applyImpulse({ x: sign * 0.09, y: 0.08 + wave * 0.12, z: -wave * 0.14 }, true);
          if (shin?.body && !shin.gone) shin.body.applyImpulse({ x: sign * 0.06, y: 0.08 - wave * 0.1, z: wave * 0.12 }, true);
        }
      }
      return;
    }

    state.stress = Math.max(0, state.stress - dt * 0.4);
    state.stunTimer = Math.max(0, (state.stunTimer || 0) - dt);
    state.stepCooldown = Math.max(0, state.stepCooldown - dt);
    const up = V(0, 1, 0).applyQuaternion(rd.quat('pelvis'));
    const tilt = Math.acos(Math.max(-1, Math.min(1, up.y)));
    const feet = ['L', 'R'].map((side) => rd.parts['foot' + side]);
    const usableFeet = feet.filter((foot) => {
      const side = foot.name.slice(-1);
      return !foot.gone && !foot.broken && !rd.parts['shin' + side].broken && !rd.parts['thigh' + side].broken && !this.organs?.state.limp.has('shin' + side) && !this.organs?.state.limp.has('thigh' + side);
    });
    const commanded = state.command.lengthSq() > 0.04;
    const bracing = commanded && state.stunTimer === 0 && usableFeet.length > 0;
    const planted = usableFeet.filter((foot) => foot.touch);
    const supportFeet = planted.length ? planted : usableFeet;
    const support = V();
    if (supportFeet.length) {
      for (const foot of supportFeet) support.add(rd.pos(foot.name));
      support.multiplyScalar(1 / supportFeet.length);
    } else support.copy(rd.pos('pelvis'));

    const com = rd.com();
    const velocity = rd.comVel();
    const capture = com.clone().addScaledVector(velocity, 0.31);
    const error = capture.sub(support).setY(0);
    const errorLength = error.length();
    const instability = Math.max(0, Math.min(1, (errorLength - 0.09) / 0.42 + tilt * 0.2 + state.stress * 0.2));
    const recovery = Math.max(bracing ? 0.7 : 0.08, Math.min(1, 1 - Math.max(0, tilt - 0.78) * 0.9));
    const muscle = bracing
      ? { spine: 1.25, chest: 1.1, head: 0.42, thigh: 1.55, shin: 1.35, foot: 0.8, upper: 0.34, fore: 0.25 }
      : { spine: 0.86, chest: 0.8, head: 0.36, thigh: 1.08, shin: 0.96, foot: 0.56, upper: 0.34, fore: 0.25 };
    const heldSides = new Set(this.woundHold?.hands.map((hand) => hand.side) || []);
    for (const p of rd.list) {
      if (!p.parent) continue;
      const injured = this.organs?.state.limp.has(p.name);
      p.strength = p.broken ? 0.012 : injured ? 0 : muscle[p.kind] * (0.82 + instability * 0.28) * recovery;
      p.damping = 0.9 + recovery * 0.18;
      if (heldSides.has(p.name.slice(-1)) && (p.kind === 'upper' || p.kind === 'fore')) p.strength = 0.08;
    }

    if (state.step) {
      const step = state.step;
      step.time += dt;
      const u = Math.min(1, step.time / step.duration);
      const progress = u * u * (3 - 2 * u);
      const lift = Math.sin(Math.PI * u);
      const side = step.side;
      const thigh = rd.parts['thigh' + side];
      const shin = rd.parts['shin' + side];
      const displacement = step.displacement.clone().applyAxisAngle(V(0, 1, 0), -state.yaw);
      const legLength = Math.max(0.6, (DIM.THIGH + DIM.SHIN) * this.hero.S * this.hero.kL);
      const hipX = Math.max(-0.52, Math.min(0.52, -displacement.z / legLength * 1.45)) * progress;
      const hipZ = Math.max(-0.38, Math.min(0.38, displacement.x / legLength * 1.25)) * progress;
      const swing = new THREE.Quaternion().setFromEuler(new THREE.Euler(hipX, 0, hipZ, 'XZY'));
      if (!thigh.joint || !shin.joint || this.organs?.state.limp.has(thigh.name) || this.organs?.state.limp.has(shin.name)) {
        state.step = null;
      } else {
        thigh.targetQ.copy(thigh.balanceQ).multiply(swing);
        shin.target.x = shin.balanceKnee + lift * 0.8;
        thigh.strength = Math.max(thigh.strength, 0.68 * recovery);
        shin.strength = Math.max(shin.strength, 0.62 * recovery);
      }
      if (u >= 1) {
        const parentQ = rd.quat(thigh.parent.name).invert();
        thigh.balanceQ.copy(parentQ.multiply(rd.quat(thigh.name)));
        thigh.targetQ.copy(thigh.balanceQ);
        shin.balanceKnee = rd.angles(shin.name).x;
        shin.target.x = shin.balanceKnee;
        state.step = null;
        state.stepCooldown = 0.12;
      }
    } else {
      for (const side of ['L', 'R']) {
        const thigh = rd.parts['thigh' + side], shin = rd.parts['shin' + side];
        if (thigh.balanceQ) thigh.targetQ.copy(thigh.balanceQ);
        if (shin.balanceKnee !== undefined) shin.target.x = shin.balanceKnee;
      }
    }

    const pelvisHeight = rd.pos('pelvis').y;
    const torsoOnGround = ['pelvis', 'spine', 'chest'].some((name) => rd.parts[name].touch);
    const laidDown = torsoOnGround && tilt > 1.0 && pelvisHeight < 0.78;
    const moving = commanded;
    if (laidDown && !moving && !state.reflex) state.reflexIn -= dt;
    if (!state.reflex && laidDown && !moving && !state.step && state.reflexIn <= 0) {
      const legs = ['L', 'R'].map((side) => ({ side, thigh: rd.parts['thigh' + side], shin: rd.parts['shin' + side] }));
      if (legs.every(({ thigh, shin }) => !thigh.gone && !shin.gone && !thigh.broken && !shin.broken
        && !this.organs?.state.limp.has(thigh.name) && !this.organs?.state.limp.has(shin.name))) {
        state.reflex = { time: 0, cycleDuration: 0.72, cycles: 3, legs: legs.map(({ side, shin }) => ({ side, knee: rd.angles(shin.name).x })) };
        state.reflexIn = 2.5 + Math.random() * 4;
      } else state.reflexIn = 2.5 + Math.random() * 4;
    }
    if (state.reflex && (moving || state.step || !laidDown)) state.reflex = null;
    if (state.reflex) {
      const reflex = state.reflex;
      reflex.time += dt;
      const cycle = reflex.time / reflex.cycleDuration;
      if (cycle >= reflex.cycles) {
        state.reflex = null;
        state.reflexIn = 2.5 + Math.random() * 4;
      }
      else for (const [index, leg] of reflex.legs.entries()) {
        const phase = (cycle + index * 0.5) % 1;
        const kick = Math.sin(Math.PI * phase);
        const thigh = rd.parts['thigh' + leg.side], shin = rd.parts['shin' + leg.side];
        reflexEuler.set(-0.72 * kick, 0, 0, 'XZY');
        reflexQuat.setFromEuler(reflexEuler);
        if (thigh.balanceQ) thigh.targetQ.copy(thigh.balanceQ).multiply(reflexQuat);
        shin.target.x = leg.knee + kick * 1.65;
        thigh.strength = Math.max(thigh.strength, 0.92);
        shin.strength = Math.max(shin.strength, 0.92);
      }
    }

    const localError = error.clone().applyAxisAngle(V(0, 1, 0), -state.yaw);
    const localVelocity = velocity.clone().applyAxisAngle(V(0, 1, 0), -state.yaw);
    const localPush = state.push.clone().applyAxisAngle(V(0, 1, 0), -state.yaw);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.max(-0.16, Math.min(0.16, -localVelocity.z * 0.03 - localError.z * 0.12 - localPush.z * state.stress * 0.025)),
      state.yaw,
      Math.max(-0.16, Math.min(0.16, localVelocity.x * 0.03 + localError.x * 0.12 + localPush.x * state.stress * 0.025)),
      'YXZ',
    ));
    if ((planted.length || bracing) && tilt < (bracing ? 1.75 : 1.55) && (!commanded || bracing)) {
      rd.assistRotation('pelvis', target, bracing ? 5.0 + instability * 0.25 : 3.0 + instability * 0.35, dt, bracing ? 1500 : 340 + instability * 80);
    }

    if (!state.step && !laidDown && state.stepCooldown === 0 && usableFeet.length > 0 && (errorLength > 0.12 || state.command.lengthSq() > 0.04) && tilt < 1.6 && velocity.length() < 7) {
      const stepSide = state.command.lengthSq() > 0.04 && usableFeet.length > 1 ? state.nextStepSide : usableFeet.reduce((best, foot) => {
        const distance = rd.pos(foot.name).distanceToSquared(support.clone().add(error));
        return !best || distance > best.distance ? { side: foot.name.slice(-1), distance } : best;
      }, null).side;
      const running = state.run && state.command.lengthSq() > 0.04;
      const displacement = error.clone().clampLength(0.12, running ? 0.58 : 0.38);
      if (state.command.lengthSq() > 0.04) displacement.lerp(state.command.clone().setY(0).normalize().multiplyScalar(running ? 0.52 : 0.28), 0.8);
      state.step = { side: stepSide, time: 0, duration: running ? 0.34 : 0.48, displacement };
      state.nextStepSide = usableFeet.length > 1 ? stepSide === 'L' ? 'R' : 'L' : stepSide;
      state.stepCooldown = state.command.lengthSq() > 0.04 ? (running ? 0.025 : 0.08) : 0.34;
    }
  }

  returnToAnimation(force = false) {
    if (this.mode !== 'ragdoll' || this.brain.dead || this.rd.list.some((p) => p.broken || this.organs?.state.limp.has(p.name))) return false;
    // hero.reset() stands the character straight up: only allowed when the body is already roughly upright,
    // otherwise a downed character visibly teleports into the idle pose (e.g. when shot on the ground).
    if (!force) {
      const up = V(0, 1, 0).applyQuaternion(this.rd.quat('pelvis')).y;
      if (up < 0.8 || this.rd.pos('pelvis').y < 0.55) return false;
    }
    const pose = this.rd.read({});
    const pelvis = pose.pelvis;
    const yaw = new THREE.Euler().setFromQuaternion(pelvis.quat, 'YXZ').y;
    this.hero.reset(V(pelvis.pos.x, Math.max(0, pelvis.pos.y - this.hero.D.HIP_Y), pelvis.pos.z), yaw);
    this.hero.update(1 / 60, { move: V(), run: false, jump: false, camYaw: yaw });
    for (const p of this.rd.list) p.body.setEnabled(false);
    this.mode = 'anim';
    this.balanceState = null;
    this.deathState = null;
    this.apply(this.capture());
    return true;
  }

  breakBone(name) {
    if (this.mode !== 'ragdoll') this.goRagdoll();
    if (!this.rd.breakBone(name)) return false;
    this.onBoneBreak?.(name, this.rd.pos(name, V()));
    return true;
  }

  hit(part, point, direction, force) {
    this.hero.damageVoxels?.(part, point, force);
    const localPoint = this.woundPointLocal(part, point);
    this.goRagdoll();
    this.rd.impulseAt(part, direction.clone().normalize().multiplyScalar(force), point);
    this.stagger(force, direction);
    this.wounds?.gunshot(part, point, direction, force);
    if (part === 'pelvis') this.onPelvisHit?.(point, force);
    this.startWoundHold(part, localPoint);
  }

  bluntHit(part, point, normal, incoming, force) {
    this.hero.damageVoxels?.(part, point, force);
    const localPoint = this.woundPointLocal(part, point);
    const direction = incoming.clone().normalize();
    this.goRagdoll();
    this.rd.impulseAt(part, direction.clone().multiplyScalar(force), point);
    this.stagger(force, direction);
    this.wounds?.injure(part, point, normal, incoming, Math.min(1.8, Math.max(0.25, force * 0.12)));
    this.onPain?.(part, 'impact', force);
    if (part === 'pelvis') this.onPelvisHit?.(point, force);
    this.startWoundHold(part, localPoint);
  }

  sever(system, type) {
    this.goRagdoll();
    this.apply(this.rd.read({}));
    const part = type === 'arm' ? 'upperR' : type === 'torso' ? 'spine' : 'head';
    const localPoint = type === 'arm' ? V(0, -0.16, 0) : type === 'torso' ? V(0, 0.1, 0) : V(0, 0.12, 0);
    const localNormal = type === 'torso' || type === 'gib' ? V(0, 1, 0) : V(0, -1, 0);
    const group = this.groups[part];
    group.updateWorldMatrix(true, true);
    const point = group.localToWorld(localPoint.clone());
    const normal = localNormal.applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    system.sever(this, part, point, normal, normal.clone().multiplyScalar(9), { gib: type === 'gib' });
  }

  update(dt, externalBodies = [], colliders = null) {
    if (this.mode !== 'ragdoll') return;
    this.handAnimTime = (this.handAnimTime || 0) + dt;
    this.contactClock -= dt;
    if (this.contactClock <= 0) {
      this.contactClock = 0.05;
      this.rd.updateContacts(externalBodies);
    }
    this.rd.selfCollide(dt);
    this.updateBalance(dt);
    if (!this.brain.dead && this.balanceState?.command.lengthSq() > 0.0001) {
      const state = this.balanceState;
      const direction = state.command.clone().setY(0).normalize();
      const speed = state.run ? 3.6 : 1.65;
      const velocityError = direction.multiplyScalar(speed).sub(this.rd.comVel().setY(0));
      const acceleration = velocityError.clampLength(0, state.run ? 7 : 4).multiplyScalar(1.6 * dt);
      for (const p of this.rd.list) {
        if (p.gone) continue;
        const impulse = acceleration.clone().multiplyScalar(p.body.mass());
        p.body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);
      }
    }
    this.rd.drive();
    if (this.woundHold) {
      const hold = this.woundHold;
      const targetBody = this.rd.parts[hold.part]?.body;
      if (this.brain.dead || !targetBody) this.woundHold = null;
      else {
        const pointVelocity = (body, point) => {
          const t = body.translation(), v = body.linvel(), w = body.angvel();
          const offset = point.clone().sub(V(t.x, t.y, t.z));
          return V(v.x, v.y, v.z).add(V(w.x, w.y, w.z).cross(offset));
        };
        for (const grip of hold.hands) {
          const arm = 'fore' + grip.side;
          const forearm = this.rd.parts[arm];
          if (!forearm || forearm.gone) continue;
          const woundLocal = hold.localPoint.clone();
          woundLocal.x += grip.offset;
          const target = this.rd.point(hold.part, woundLocal, V());
          const hand = this.rd.point(arm, V(0, -(DIM.FOREARM * this.hero.kA + 0.04) * this.hero.S, 0), V());
          const relativeVelocity = pointVelocity(forearm.body, hand).sub(pointVelocity(targetBody, target));
          const pull = target.clone().sub(hand).multiplyScalar(230).sub(relativeVelocity.multiplyScalar(31)).clampLength(0, 150);
          const impulse = pull.multiplyScalar(dt);
          forearm.body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: hand.x, y: hand.y, z: hand.z }, true);
          targetBody.applyImpulseAtPoint({ x: -impulse.x, y: -impulse.y, z: -impulse.z }, { x: target.x, y: target.y, z: target.z }, true);
        }
      }
    }
    for (const p of this.rd.list) {
      if (p.gone) continue;
      const v = p.body.linvel();
      const sample = this.impactSamples.get(p.name);
      if (sample) {
        const impact = Math.hypot(v.x - sample.x, v.y - sample.y + 9.81 * dt, v.z - sample.z);
        sample.cooldown = Math.max(0, sample.cooldown - dt);
        if (impact > 1.8 && sample.cooldown === 0) {
          this.fallAudio?.(this.rd.pos(p.name, V()), Math.min(0.9, 0.12 + impact * 0.065));
          sample.cooldown = 0.18;
        }
        sample.x = v.x; sample.y = v.y; sample.z = v.z;
      } else this.impactSamples.set(p.name, { x: v.x, y: v.y, z: v.z, cooldown: 0 });
    }
    this.apply(this.rd.read({}));
  }

  dispose() {
    this.wounds?.heal();
    this.organs?.heal();
    this.rd.dispose();
    for (const rope of this.boundLines) for (const segment of rope) segment.removeFromParent();
    this.boundRopeGeo.dispose();
    this.boundRopeMat.dispose();
    this.boundTieMat.dispose();
    this.boundCuffGeo.dispose();
    this.boundAnkleCuffGeo.dispose();
    this.hero.root.removeFromParent();
    for (const group of Object.values(this.groups)) group.removeFromParent();
  }
}
