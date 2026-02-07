import * as THREE from 'three';
import { rrShape, rrPath } from './helpers';

/**
 * Create a procedural wayfarer-style sunglasses model.
 * Returns a THREE.Group with all meshes at renderOrder = 3.
 *
 * To customize: adjust dimensions, materials, or swap this function entirely
 * with your own model loader (e.g., GLTFLoader).
 */
export function createSunglasses() {
    var g = new THREE.Group();

    // ── Dimensions (model units ≈ mm) ──
    var lensW = 58, lensH = 34;
    var ftTop = 8, ftBot = 3, ftSide = 4;
    var bridgeW = 14, fd = 6;
    var tLen = 50, tW = 4.5, tH = 3;
    var lensR = 5, frameR = 6;

    // ── Materials ──
    var frameMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a12,
        metalness: 0.25,
        roughness: 0.25,
        side: THREE.FrontSide
    });

    var lensMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        metalness: 0.1,
        roughness: 0.05,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    // ── Frame (extruded rounded rect with lens hole) ──
    var oW = lensW + ftSide * 2;
    var oH = lensH + ftTop + ftBot;
    var vOff = (ftTop - ftBot) / 2;

    var outer = rrShape(oW, oH, frameR, vOff);
    outer.holes.push(rrPath(lensW, lensH, lensR));

    var fGeom = new THREE.ExtrudeBufferGeometry(outer, {
        depth: fd,
        bevelEnabled: true,
        bevelThickness: 0.8,
        bevelSize: 0.6,
        bevelSegments: 2
    });
    fGeom.computeVertexNormals();

    var cx = bridgeW / 2 + oW / 2;

    var lf = new THREE.Mesh(fGeom, frameMat);
    lf.position.set(-cx, 0, -fd / 2);
    var rf = new THREE.Mesh(fGeom.clone(), frameMat);
    rf.position.set(cx, 0, -fd / 2);

    // ── Lenses ──
    var lGeom = new THREE.ShapeBufferGeometry(
        rrShape(lensW - 0.5, lensH - 0.5, lensR - 0.3), 12
    );
    var ll = new THREE.Mesh(lGeom, lensMat);
    ll.position.set(-cx, 0, 0.5);
    var rl = new THREE.Mesh(lGeom.clone(), lensMat);
    rl.position.set(cx, 0, 0.5);

    // ── Bridge ──
    var bGeo = new THREE.BoxBufferGeometry(bridgeW + ftSide, 3.5, fd * 0.7);
    var br = new THREE.Mesh(bGeo, frameMat);
    br.position.set(0, lensH * 0.15 + vOff, 0);

    // ── Temple arms (with outward splay via pivot groups) ──
    var tGeo = new THREE.BoxBufferGeometry(tW, tH, tLen);
    var tOutX = cx + oW / 2 - ftSide / 2;
    var tY = lensH * 0.15 + vOff;
    var tSplay = 0.08; // ~4.6° outward

    var ltPivot = new THREE.Group();
    ltPivot.position.set(-tOutX, tY, -fd / 2);
    var lt = new THREE.Mesh(tGeo, frameMat);
    lt.position.set(0, 0, -tLen / 2);
    ltPivot.add(lt);
    ltPivot.rotation.y = -tSplay;

    var rtPivot = new THREE.Group();
    rtPivot.position.set(tOutX, tY, -fd / 2);
    var rt = new THREE.Mesh(tGeo.clone(), frameMat);
    rt.position.set(0, 0, -tLen / 2);
    rtPivot.add(rt);
    rtPivot.rotation.y = tSplay;

    // ── Nose pads ──
    var npMat = new THREE.MeshStandardMaterial({
        color: 0xbbbbbb, metalness: 0, roughness: 0.6,
        transparent: true, opacity: 0.4
    });
    var npGeo = new THREE.SphereBufferGeometry(2.5, 8, 6);
    var lnp = new THREE.Mesh(npGeo, npMat);
    lnp.position.set(-bridgeW / 2 + 1, -lensH * 0.22, fd * 0.15);
    var rnp = new THREE.Mesh(npGeo, npMat);
    rnp.position.set(bridgeW / 2 - 1, -lensH * 0.22, fd * 0.15);

    // ── Assemble ──
    g.add(lf, rf, ll, rl, br, ltPivot, rtPivot, lnp, rnp);

    g.traverse(function(c) {
        if (c.isMesh) c.renderOrder = 3;
    });

    return g;
}
