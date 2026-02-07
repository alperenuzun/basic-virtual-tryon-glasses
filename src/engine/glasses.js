import * as THREE from 'three';

/**
 * Create a premium wire-frame sunglasses model.
 * Entirely procedural — no external assets needed.
 *
 * Style: Clean gold wire-rim with dark Havana acetate temple tips
 *   - Gold metal wire rim around each lens
 *   - G-15 green-grey tinted lenses
 *   - Gold arched bridge
 *   - Straight gold tubular temple arms with acetate end tips
 *   - Gold hinge details
 *
 * Returns a THREE.Group with all meshes at renderOrder = 3.
 */
export function createSunglasses() {
    var g = new THREE.Group();

    // ══════════════════════════════════════════════════════════════════════
    // DIMENSIONS (model-space ≈ mm)
    // ══════════════════════════════════════════════════════════════════════
    var lensW      = 52;    // lens width
    var lensH      = 43;    // lens height
    var bridgeGap  = 17;    // horizontal space between lens centers
    var wireR      = 0.7;   // metal rim wire radius
    var templeLen  = 56;    // temple arm length

    // X-center of each lens
    var cx = bridgeGap / 2 + lensW / 2 + 1.5;

    // ══════════════════════════════════════════════════════════════════════
    // MATERIALS
    // ══════════════════════════════════════════════════════════════════════

    // Dark Havana acetate — for temple tips only
    var acetateMat = new THREE.MeshPhysicalMaterial({
        color: 0x3d1f0d,
        metalness: 0.0,
        roughness: 0.16,
        clearcoat: 0.95,
        clearcoatRoughness: 0.06,
        reflectivity: 0.5,
        side: THREE.DoubleSide
    });

    // Warm gold metal
    var goldMat = new THREE.MeshStandardMaterial({
        color: 0xc9a54e,
        metalness: 0.92,
        roughness: 0.12,
        side: THREE.DoubleSide
    });

    // Darker gold for subtle details
    var goldDarkMat = new THREE.MeshStandardMaterial({
        color: 0xa08030,
        metalness: 0.88,
        roughness: 0.18,
        side: THREE.FrontSide
    });

    // Classic G-15 green-grey lens tint
    var lensMat = new THREE.MeshPhysicalMaterial({
        color: 0x1c2e1c,
        metalness: 0.05,
        roughness: 0.02,
        transparent: true,
        opacity: 0.68,
        side: THREE.DoubleSide,
        depthWrite: false,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        envMapIntensity: 0.3
    });

    // ══════════════════════════════════════════════════════════════════════
    // HELPER: Elliptical curve (3D points for TubeGeometry)
    // ══════════════════════════════════════════════════════════════════════
    function ellipseCurve3D(w, h, segments) {
        segments = segments || 72;
        var pts = [];
        for (var i = 0; i <= segments; i++) {
            var a = (i / segments) * Math.PI * 2;
            pts.push(new THREE.Vector3(
                Math.cos(a) * w * 0.5,
                Math.sin(a) * h * 0.5,
                0
            ));
        }
        return new THREE.CatmullRomCurve3(pts, true);
    }

    // ══════════════════════════════════════════════════════════════════════
    // METAL WIRE RIM (full ellipse around each lens)
    // ══════════════════════════════════════════════════════════════════════
    function buildRim(xOff) {
        var curve = ellipseCurve3D(lensW, lensH);
        var geo = new THREE.TubeGeometry(curve, 72, wireR, 8, true);
        var mesh = new THREE.Mesh(geo, goldMat);
        mesh.position.x = xOff;
        return mesh;
    }

    g.add(buildRim(-cx));
    g.add(buildRim(cx));

    // ══════════════════════════════════════════════════════════════════════
    // LENSES (flat elliptical discs)
    // ══════════════════════════════════════════════════════════════════════
    function buildLens(xOff) {
        var shape = new THREE.Shape();
        shape.absellipse(0, 0, lensW * 0.485, lensH * 0.485, 0, Math.PI * 2, false, 0);
        var geo = new THREE.ShapeGeometry(shape, 48);
        var mesh = new THREE.Mesh(geo, lensMat);
        mesh.position.set(xOff, 0, 0.2);
        return mesh;
    }

    g.add(buildLens(-cx));
    g.add(buildLens(cx));

    // ══════════════════════════════════════════════════════════════════════
    // METAL BRIDGE (gold wire connecting the two rims — arched)
    // ══════════════════════════════════════════════════════════════════════
    var bridgePts = [
        new THREE.Vector3(-cx + lensW * 0.35, lensH * 0.08, wireR),
        new THREE.Vector3(-bridgeGap * 0.25,  lensH * 0.18, wireR * 2),
        new THREE.Vector3(0,                   lensH * 0.22, wireR * 2.5),
        new THREE.Vector3( bridgeGap * 0.25,  lensH * 0.18, wireR * 2),
        new THREE.Vector3( cx - lensW * 0.35, lensH * 0.08, wireR)
    ];
    var bridgeCurve = new THREE.CatmullRomCurve3(bridgePts);
    var bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 24, wireR * 1.2, 8, false);
    g.add(new THREE.Mesh(bridgeGeo, goldMat));

    // ══════════════════════════════════════════════════════════════════════
    // TEMPLE ARMS — completely straight
    // Thin gold metal tube + acetate end tip sleeve
    // ══════════════════════════════════════════════════════════════════════
    function buildTemple(side) {
        var pivot = new THREE.Group();

        var hingeX = side * (cx + lensW * 0.5 + 2.5);
        var hingeY = lensH * 0.2;
        pivot.position.set(hingeX, hingeY, 0);

        // Perfectly straight path from hinge to tip
        var armPath = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0,  0),
            new THREE.Vector3(0, 0, -templeLen * 0.5),
            new THREE.Vector3(0, 0, -templeLen)
        ]);

        // Main gold metal arm
        var armGeo = new THREE.TubeGeometry(armPath, 32, 1.0, 8, false);
        pivot.add(new THREE.Mesh(armGeo, goldMat));

        // Acetate end tip (thicker sleeve on last ~35%)
        var tipPath = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, -templeLen * 0.65),
            new THREE.Vector3(0, 0, -templeLen * 0.82),
            new THREE.Vector3(0, 0, -templeLen)
        ]);
        var tipGeo = new THREE.TubeGeometry(tipPath, 16, 1.6, 8, false);
        pivot.add(new THREE.Mesh(tipGeo, acetateMat));

        // Subtle outward splay
        pivot.rotation.y = side * 0.06;

        return pivot;
    }

    g.add(buildTemple(-1));
    g.add(buildTemple(1));

    // ══════════════════════════════════════════════════════════════════════
    // HINGE DETAILS (barrel + plate at frame-temple junction)
    // ══════════════════════════════════════════════════════════════════════
    function buildHinge(side) {
        var hg = new THREE.Group();

        // Barrel cylinder
        var barrelGeo = new THREE.CylinderGeometry(1.4, 1.4, 4, 12);
        var barrel = new THREE.Mesh(barrelGeo, goldMat);
        hg.add(barrel);

        // Mounting plate
        var plateGeo = new THREE.BoxGeometry(3.5, 5, 1.3);
        var plate = new THREE.Mesh(plateGeo, goldMat);
        plate.position.set(-side * 1.5, 0, 0);
        hg.add(plate);

        // Screw head
        var screwGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8);
        var screw = new THREE.Mesh(screwGeo, goldDarkMat);
        screw.rotation.x = Math.PI / 2;
        screw.position.set(-side * 2.2, 0, 0.8);
        hg.add(screw);

        hg.position.set(
            side * (cx + lensW * 0.5 + 1),
            lensH * 0.2,
            -0.5
        );
        return hg;
    }

    g.add(buildHinge(-1));
    g.add(buildHinge(1));

    // ══════════════════════════════════════════════════════════════════════
    // RENDER ORDER
    // ══════════════════════════════════════════════════════════════════════
    g.traverse(function(child) {
        if (child.isMesh) child.renderOrder = 3;
    });

    return g;
}
