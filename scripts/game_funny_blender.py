#!/usr/bin/env python3
"""Create short, original Minecraft/Roblox-inspired slapstick films in Blender."""

import argparse
import math
import os
import sys
from mathutils import Vector
import bpy


FPS = 24
DURATION = 60
TOTAL = FPS * DURATION


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--kind", choices=("minecraft", "roblox"), required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--blend", required=True)
    p.add_argument("--width", type=int, default=720)
    p.add_argument("--height", type=int, default=1280)
    p.add_argument("--fps", type=int, default=FPS)
    p.add_argument("--still", type=int, default=0, help="Render one frame only, for look-dev.")
    return p.parse_args(argv)


def material(name, color, roughness=0.75, metallic=0.0, emission=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    for socket in ("Emission Color", "Emission"):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = (*color, 1.0)
            break
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def empty(name, parent=None, loc=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    obj.location = loc
    return obj


def cube(name, loc, dims, mat, parent=None, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    if parent:
        obj.parent = parent
    obj.location = loc
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Soft pixel edges", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


def sphere(name, loc, radius, mat, parent=None, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=radius, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    if parent:
        obj.parent = parent
    obj.location = loc
    if scale:
        obj.scale = scale
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def text_obj(name, text, loc, size, mat, parent=None, rot=(math.pi / 2, 0, 0)):
    bpy.ops.object.text_add(location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.size = size
    obj.data.extrude = 0.025
    obj.data.bevel_depth = 0.004
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    if parent:
        obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    obj.data.materials.append(mat)
    return obj


def key(obj, prop, frame, value, index=None):
    if index is None:
        setattr(obj, prop, value)
        obj.keyframe_insert(data_path=prop, frame=frame)
    else:
        arr = list(getattr(obj, prop))
        arr[index] = value
        setattr(obj, prop, arr)
        obj.keyframe_insert(data_path=prop, index=index, frame=frame)


def smooth_keys(obj):
    if not obj.animation_data or not obj.animation_data.action:
        return
    # Blender 5.3 uses layered Actions; newly inserted keys already default to
    # automatic Bezier handles there. Older Blender versions expose fcurves.
    try:
        curves = obj.animation_data.action.fcurves
    except AttributeError:
        return
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"


def animate_vector(obj, prop, frames):
    for frame, value in frames:
        setattr(obj, prop, value)
        obj.keyframe_insert(data_path=prop, frame=frame)
    smooth_keys(obj)


def walk_cycle(char, start, end, period=14, amount=0.46, bounce=0.1):
    legs = char["legs"]
    arms = char.get("arms", [])
    f = start
    while f <= end:
        phase = (f - start) / period * math.tau
        swing = math.sin(phase) * amount
        movement = []
        if len(legs) == 2:
            movement.extend(((legs[0], swing), (legs[1], -swing)))
        else:
            for idx, part in enumerate(legs):
                movement.append((part, swing if idx in (0, 3) else -swing))
        if len(arms) >= 2:
            movement.extend(((arms[0], -swing * 0.82), (arms[1], swing * 0.82)))
        for part, angle in movement:
            part.rotation_euler.x = angle
            part.keyframe_insert(data_path="rotation_euler", index=0, frame=f)
        char["body"].location.z = char.get("body_base_z", 1.5) + (abs(math.sin(phase)) * bounce)
        char["body"].keyframe_insert(data_path="location", index=2, frame=f)
        # One key per frame avoids the staccato, four-frame foot swings from
        # the first draft and keeps the loop smooth at the final 24 fps render.
        f += 1
    smooth_keys(char["body"])
    for part in char["legs"] + char["arms"]:
        smooth_keys(part)


def idle_cycle(char, start, end, period=76):
    """Keep characters alive in held dialogue beats with tiny breathing/gaze."""
    body = char["body"]
    head = char["head"]
    base_z = char.get("body_base_z", body.location.z)
    f = start
    while f <= end:
        phase = (f - start) / period * math.tau
        body.location.z = base_z + 0.018 * math.sin(phase)
        body.keyframe_insert(data_path="location", index=2, frame=f)
        head.rotation_euler.x = 0.025 * math.sin(phase + 0.5)
        head.rotation_euler.z = 0.035 * math.sin(phase * 0.5)
        head.keyframe_insert(data_path="rotation_euler", frame=f)
        f += 3
    smooth_keys(body)
    smooth_keys(head)


def animate_dense_vector(obj, prop, frames, every_frame=True):
    """Bake a small, deliberate motion path so playback is deterministic."""
    ordered = sorted(frames, key=lambda item: item[0])
    first, last = ordered[0][0], ordered[-1][0]
    if not every_frame:
        animate_vector(obj, prop, ordered)
        return
    segment = 0
    for frame in range(first, last + 1):
        while segment < len(ordered) - 2 and frame > ordered[segment + 1][0]:
            segment += 1
        f0, v0 = ordered[segment]
        f1, v1 = ordered[segment + 1]
        t = 0.0 if f1 == f0 else max(0.0, min(1.0, (frame - f0) / (f1 - f0)))
        # Smoothstep has zero velocity at each story beat: anticipation,
        # impact, and settle read as distinct poses rather than drift.
        t = t * t * (3.0 - 2.0 * t)
        value = tuple(a + (b - a) * t for a, b in zip(v0, v1))
        key(obj, prop, frame, value)
    smooth_keys(obj)


def pose(char, frame, arm_l=None, arm_r=None, leg_l=None, leg_r=None, body_yaw=None, root_tilt=None):
    values = []
    if len(char.get("arms", [])) > 0:
        values.append((char["arms"][0], arm_l))
    if len(char.get("arms", [])) > 1:
        values.append((char["arms"][1], arm_r))
    if len(char.get("legs", [])) > 0:
        values.append((char["legs"][0], leg_l))
    if len(char.get("legs", [])) > 1:
        values.append((char["legs"][1], leg_r))
    for obj, angle in values:
        if angle is not None:
            key(obj, "rotation_euler", frame, (angle, obj.rotation_euler.y, obj.rotation_euler.z))
    if body_yaw is not None:
        key(char["body"], "rotation_euler", frame, (char["body"].rotation_euler.x, char["body"].rotation_euler.y, body_yaw))
    if root_tilt is not None:
        key(char["root"], "rotation_euler", frame, root_tilt)


def build_avatar(name, scheme, face_color, pants_color, accessory="none"):
    root = empty(name + " Root")
    body = empty(name + " Body", root, (0, 0, 1.5))
    torso = cube(name + " Torso", (0, 0, 0), (0.88, 0.52, 0.96), scheme["torso"], body, 0.035)
    head = empty(name + " Head", body, (0, -0.015, 0.95))
    cube(name + " Head Block", (0, 0, 0), (0.86, 0.72, 0.84), face_color, head, 0.028)
    # Face points toward -Y, so it reads in the hero cameras.
    for side in (-1, 1):
        x = side * 0.205
        cube(name + " Eye White", (x, -0.372, 0.085), (0.16, 0.055, 0.18), scheme["white"], head, 0.008)
        cube(name + " Pupil", (x + 0.015, -0.408, 0.075), (0.075, 0.035, 0.1), scheme["dark"], head, 0.003)
        cube(name + " Brow", (x, -0.38, 0.24), (0.2, 0.07, 0.065), scheme["dark"], head, 0.005)
    cube(name + " Smile", (0, -0.376, -0.19), (0.23, 0.05, 0.065), scheme["dark"], head, 0.005)
    open_mouth = cube(name + " Surprise Mouth", (0, -0.383, -0.19), (0.2, 0.055, 0.22), scheme["dark"], head, 0.015)
    # Simple neck collar and little backpack make the silhouette readable.
    cube(name + " Collar", (0, 0.005, 0.48), (0.42, 0.55, 0.17), scheme["accent"], body, 0.01)
    cube(name + " Backpack", (0, 0.34, -0.05), (0.62, 0.28, 0.68), scheme["pack"], body, 0.025)
    legs = []
    for idx, side in enumerate((-1, 1)):
        pivot = empty(name + (" Left Leg" if idx == 0 else " Right Leg"), root, (side * 0.24, 0, 1.01))
        cube(name + " Pants", (0, 0, -0.46), (0.36, 0.43, 0.9), pants_color, pivot, 0.022)
        cube(name + " Boot", (0, -0.075, -0.88), (0.4, 0.54, 0.22), scheme["boot"], pivot, 0.02)
        legs.append(pivot)
    arms = []
    for idx, side in enumerate((-1, 1)):
        pivot = empty(name + (" Left Arm" if idx == 0 else " Right Arm"), body, (side * 0.59, 0, 0.42))
        cube(name + " Sleeve", (0, 0, -0.34), (0.34, 0.45, 0.66), scheme["torso"], pivot, 0.018)
        cube(name + " Hand", (0, -0.005, -0.72), (0.32, 0.42, 0.23), face_color, pivot, 0.014)
        arms.append(pivot)
    if accessory == "cap":
        cube(name + " Cap Crown", (0, 0.01, 0.43), (0.92, 0.74, 0.26), scheme["hat"], head, 0.025)
        cube(name + " Cap Brim", (0, -0.4, 0.34), (0.98, 0.54, 0.1), scheme["hat"], head, 0.015)
    elif accessory == "crown":
        for i, x in enumerate((-0.28, 0, 0.28)):
            cube(name + " Crown Point " + str(i), (x, 0, 0.58), (0.16, 0.18, 0.3), scheme["hat"], head, 0.01)
        cube(name + " Crown Band", (0, 0, 0.43), (0.9, 0.76, 0.14), scheme["hat"], head, 0.012)
    if accessory == "visor":
        cube(name + " Shades", (0, -0.407, 0.085), (0.65, 0.08, 0.18), scheme["dark"], head, 0.015)
    return {"root": root, "body": body, "body_base_z": 1.5, "head": head, "torso": torso, "legs": legs, "arms": arms, "open_mouth": open_mouth}


def pixel_face(parent, name, width, height, y, pixel, skin_mat, dark_mat, white_mat=None):
    """Lay a low-resolution face onto a flat block head, like a game decal."""
    # Roblox's classic smile is intentionally clean and graphic. Minecraft's
    # Steve face uses a 8 x 8 pixel layout with hair at the edge and a goatee.
    cells = max(1, round(width / pixel))
    rows = max(1, round(height / pixel))
    if "Minecraft" in name:
        hair = material("Steve Hair Pixel", (0.075, 0.032, 0.018))
        beard = material("Steve Beard Pixel", (0.12, 0.05, 0.024))
        eye = material("Steve Eye Pixel", (0.12, 0.07, 0.035))
        for row in range(rows):
            for col in range(cells):
                mat = None
                if row <= 1 or col == 0 or col == cells - 1:
                    mat = hair
                elif row == rows - 4 and col in (2, cells - 3):
                    mat = eye
                elif row == rows - 2 and col in (3, 4):
                    mat = beard
                elif row == rows - 1 and col in range(2, cells - 2):
                    mat = beard
                if mat:
                    px = -width / 2 + (col + 0.5) * pixel
                    pz = height / 2 - (row + 0.5) * pixel
                    cube(name + f" Pixel {row}-{col}", (px, y, pz), (pixel * 1.01, 0.012, pixel * 1.01), mat, parent, 0)
        return

    # Classic Roblox smile: large bright eyes and a simple stepped grin.
    eye_white = white_mat or material("Classic Face White", (0.97, 0.96, 0.87))
    eye_dark = dark_mat
    cell = min(width / 6, height / 6)
    eye_z = height * 0.13
    for x in (-width * 0.19, width * 0.19):
        cube(name + " Eye White", (x, y - 0.007, eye_z), (cell * 0.82, 0.014, cell * 1.05), eye_white, parent, 0)
        cube(name + " Eye Pupil", (x, y - 0.017, eye_z), (cell * 0.36, 0.012, cell * 0.75), eye_dark, parent, 0)
    smile = [(-2, -1), (-1, -2), (0, -2), (1, -2), (2, -1)]
    for dx, dz in smile:
        cube(name + " Smile Pixel", (dx * cell * 0.45, y - 0.009, -height * 0.18 + dz * cell * 0.24), (cell * 0.54, 0.014, cell * 0.25), eye_dark, parent, 0)


def build_minecraft_steve(name, mats):
    """A classic 8:12:4 Steve-style voxel player with separated pivots."""
    root = empty(name + " Root")
    body = empty(name + " Torso Pivot", root, (0, 0, 1.35))
    torso = cube(name + " Cyan Shirt", (0, 0, 0), (0.60, 0.30, 0.90), mats["shirt"], body, 0)
    # Small pixel collar and undershirt seam give the familiar Steve palette.
    cube(name + " Neck Skin", (0, -0.157, 0.34), (0.20, 0.018, 0.15), mats["skin"], body, 0)
    cube(name + " Shirt Seam", (0, -0.16, -0.17), (0.60, 0.018, 0.055), mats["shirt_dark"], body, 0)

    head = empty(name + " Head Pivot", body, (0, 0, 0.75))
    cube(name + " Head Block", (0, 0, 0), (0.60, 0.60, 0.60), mats["skin"], head, 0)
    cube(name + " Hair Cap", (0, 0, 0.285), (0.61, 0.61, 0.09), mats["hair"], head, 0)
    pixel_face(head, name + " Minecraft Face", 0.60, 0.60, -0.306, 0.075, mats["skin"], mats["dark"])

    legs = []
    for i, side in enumerate((-1, 1)):
        leg = empty(name + (" Left Leg" if i == 0 else " Right Leg"), root, (side * 0.15, 0, 0.90))
        cube(name + " Blue Pants", (0, 0, -0.45), (0.30, 0.30, 0.90), mats["pants"], leg, 0)
        # A darker two-pixel cuff reads as pants detail without changing Steve's silhouette.
        cube(name + " Pant Cuff", (0, -0.153, -0.39), (0.30, 0.012, 0.12), mats["pants_dark"], leg, 0)
        legs.append(leg)

    arms = []
    for i, side in enumerate((-1, 1)):
        arm = empty(name + (" Left Arm" if i == 0 else " Right Arm"), body, (side * 0.45, 0, 0.34))
        cube(name + " Cyan Sleeve", (0, 0, -0.37), (0.30, 0.30, 0.74), mats["shirt"], arm, 0)
        cube(name + " Hand", (0, 0, -0.815), (0.30, 0.30, 0.15), mats["skin"], arm, 0)
        arms.append(arm)
    mouth = cube(name + " Surprised Mouth", (0, -0.315, -0.12), (0.075, 0.014, 0.12), mats["dark"], head, 0)
    mouth.scale = (0.001, 0.001, 0.001)
    return {"root": root, "body": body, "body_base_z": 1.35, "head": head, "torso": torso, "legs": legs, "arms": arms, "open_mouth": mouth}


def build_roblox_r6(name, shirt, pants, yellow, face_dark, white, accessory=None):
    """Classic six-part R6 proportions: 2x2 torso, 1x2 limbs, square head."""
    root = empty(name + " R6 Root")
    flip = empty(name + " R6 Tumble Pivot", root, (0, 0, 1.20))
    body = empty(name + " R6 Torso", flip, (0, 0, 0.24))
    torso = cube(name + " R6 Torso Block", (0, 0, 0), (0.96, 0.48, 0.96), shirt, body, 0)

    head = empty(name + " R6 Head Pivot", body, (0, 0, 0.72))
    cube(name + " R6 Head", (0, 0, 0), (0.48, 0.48, 0.48), yellow, head, 0)
    pixel_face(head, name + " Roblox Face", 0.48, 0.48, -0.245, 0.08, yellow, face_dark, white)
    if accessory == "cap":
        cube(name + " Flat Cap", (0, 0, 0.24), (0.53, 0.53, 0.11), face_dark, head, 0)
        cube(name + " Cap Brim", (0, -0.15, 0.19), (0.57, 0.25, 0.055), face_dark, head, 0)
    elif accessory == "visor":
        cube(name + " Pro Shades", (0, -0.252, 0.075), (0.40, 0.024, 0.095), face_dark, head, 0)

    legs = []
    for i, side in enumerate((-1, 1)):
        leg = empty(name + (" R6 Left Leg" if i == 0 else " R6 Right Leg"), flip, (side * 0.24, 0, -0.24))
        cube(name + " R6 Leg", (0, 0, -0.48), (0.48, 0.48, 0.96), pants, leg, 0)
        legs.append(leg)
    arms = []
    for i, side in enumerate((-1, 1)):
        arm = empty(name + (" R6 Left Arm" if i == 0 else " R6 Right Arm"), body, (side * 0.72, 0, 0.48))
        cube(name + " R6 Arm", (0, 0, -0.48), (0.48, 0.48, 0.96), yellow, arm, 0)
        arms.append(arm)
    mouth = cube(name + " Open Mouth", (0, -0.257, -0.14), (0.08, 0.014, 0.09), face_dark, head, 0)
    mouth.scale = (0.001, 0.001, 0.001)
    return {"root": root, "flip": flip, "body": body, "body_base_z": body.location.z, "head": head, "torso": torso, "legs": legs, "arms": arms, "open_mouth": mouth}


def build_pig(scheme):
    root = empty("Pip the Pig Root")
    body = empty("Pig Body Bob", root, (0, 0, 0.94))
    cube("Pig Body", (0, 0, 0), (0.94, 1.22, 0.78), scheme["pink"], body, 0)
    head = empty("Pig Head", root, (0, -0.42, 1.52))
    cube("Pig Head Cube", (0, 0, 0), (0.86, 0.76, 0.74), scheme["pink"], head, 0)
    cube("Pig Snout", (0, -0.43, -0.1), (0.64, 0.28, 0.4), scheme["snout"], head, 0)
    for side in (-1, 1):
        cube("Pig Nostrils", (side * 0.16, -0.582, -0.08), (0.09, 0.03, 0.12), scheme["nostril"], head, 0.008)
        cube("Pig Eye", (side * 0.22, -0.386, 0.12), (0.12, 0.055, 0.14), scheme["dark"], head, 0.01)
        cube("Pig Ear", (side * 0.34, 0.03, 0.43), (0.28, 0.26, 0.44), scheme["pink"], head, 0)
    legs = []
    for x in (-0.31, 0.31):
        for y in (-0.38, 0.38):
            pivot = empty("Pig Leg", root, (x, y, 0.38))
            cube("Pig Foot", (0, 0, -0.19), (0.25, 0.29, 0.42), scheme["pink"], pivot, 0)
            legs.append(pivot)
    return {"root": root, "body": body, "body_base_z": 0.94, "head": head, "legs": legs, "arms": []}


def key_scale(obj, frames):
    base = Vector(obj.scale)
    for f, s in frames:
        obj.scale = base * s
        obj.keyframe_insert(data_path="scale", frame=f)
    smooth_keys(obj)


def build_pickaxe(parent, mats):
    tool = empty("Oversized Diamond Pickaxe", parent)
    cube("Pickaxe Handle", (0.05, -0.25, -0.88), (0.13, 0.17, 0.85), mats["wood"], tool, 0.01)
    cube("Pickaxe Head", (0.1, -0.25, -0.38), (0.93, 0.18, 0.23), mats["iron"], tool, 0.025)
    cube("Pickaxe Left Tooth", (-0.31, -0.25, -0.55), (0.18, 0.18, 0.35), mats["iron"], tool, 0.02)
    cube("Pickaxe Right Tooth", (0.51, -0.25, -0.55), (0.18, 0.18, 0.35), mats["iron"], tool, 0.02)
    tool.location = (0, 0, 0)
    return tool


def make_diamond(loc, mat, scale=1.0, name="Diamond"):
    # A deliberately faceted, voxel-cut gem.
    mesh = bpy.data.meshes.new(name + " Mesh")
    verts = [(-0.55, 0, 0), (0.55, 0, 0), (0, -0.48, 0.45), (0, 0.48, 0.45), (0, -0.38, -0.42), (0, 0.38, -0.42), (0, 0, 0.8)]
    faces = [(0, 2, 6), (2, 1, 6), (1, 3, 6), (3, 0, 6), (0, 4, 2), (2, 4, 1), (1, 4, 3), (3, 4, 0), (0, 5, 1), (1, 5, 3), (3, 5, 0)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.scale = (scale, scale, scale)
    obj.data.materials.append(mat)
    return obj


def camera(name, loc, target, scale, start, end=None, end_scale=None):
    data = bpy.data.cameras.new(name + " Lens")
    data.type = "ORTHO"
    data.ortho_scale = scale
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    if end and end_scale:
        obj.data.ortho_scale = scale
        obj.data.keyframe_insert(data_path="ortho_scale", frame=start)
        obj.data.ortho_scale = end_scale
        obj.data.keyframe_insert(data_path="ortho_scale", frame=end)
        smooth_keys(obj.data)
    marker = bpy.context.scene.timeline_markers.new(name, frame=start)
    marker.camera = obj
    return obj


def add_lighting(kind):
    world = bpy.data.worlds.new("Game Sky") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.24, 0.34, 0.49, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.38
    def area(name, loc, energy, color, size, target=(0, 0, 1.5)):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    if kind == "minecraft":
        area("Warm key", (-5, -7, 10), 1650, (1.0, 0.73, 0.48), 7)
        area("Cyan fill", (6, -2, 7), 1050, (0.25, 0.76, 1.0), 6)
        area("Lava rim", (0, 5, 5), 900, (1.0, 0.24, 0.06), 5)
    else:
        area("Softbox key", (-5, -7, 10), 1500, (0.75, 0.9, 1.0), 7)
        area("Neon fill", (6, -2, 7), 1300, (0.45, 0.3, 1.0), 6)
        area("Warm rim", (0, 5, 5), 900, (1.0, 0.52, 0.22), 5)


def block_world_minecraft(m):
    grass, dirt, stone, dark, lava, obsidian = (m[k] for k in ("grass", "dirt", "stone", "darkstone", "lava", "obsidian"))
    # Fill the portrait background with a block-built cave instead of empty sky.
    cube("Cave Backdrop", (0, 7.0, 4.2), (12.5, 0.7, 9.2), dark, bevel=0.03)
    for i, (x, z, w, h, mat) in enumerate([
        (-4.8, 2.4, 1.5, 2.0, stone), (-3.1, 4.5, 1.4, 1.1, dark), (-1.4, 6.0, 1.8, 1.1, stone),
        (0.7, 5.4, 1.6, 1.7, dark), (2.7, 6.1, 1.5, 1.2, stone), (4.7, 3.7, 1.7, 1.8, dark),
        (-4.0, 6.6, 0.9, 0.7, m["redstone"]), (3.9, 5.4, 0.9, 0.8, m["emerald"])
    ]):
        cube("Cave Wall Patch " + str(i), (x, 6.57, z), (w, 0.12, h), mat, bevel=0.02)
    # Floating grass-and-dirt arena with a lava trench behind the actors.
    cube("Arena Base", (0, 0, -0.45), (10.5, 8.5, 0.9), dirt, bevel=0.01)
    cube("Grass Surface", (0, 0, 0.015), (10.4, 8.4, 0.12), grass, bevel=0.005)
    for x in range(-5, 6):
        for y in range(-4, 5):
            if (x + 2 * y) % 4 == 0:
                cube("Grass Pixel", (x + 0.5, y + 0.5, 0.09), (0.92, 0.92, 0.08), m["grass2"], bevel=0.006)
    # Bright lava river and stepped basalt banks.
    for x in range(-4, 5):
        cube("Lava Tile", (x, 2.7, 0.14), (0.96, 1.5, 0.16), lava, bevel=0.02)
        if x % 2 == 0:
            cube("Lava Bubble", (x + 0.2, 2.5, 0.28), (0.28, 0.26, 0.07), m["yellow"], bevel=0.02)
    for x in (-5.0, 5.0):
        for z in (0.7, 1.8, 2.9, 4.0):
            cube("Cave Column", (x, 4.2, z), (1.0, 1.0, 1.0), dark if z > 1.2 else stone, bevel=0.015)
    for x, z, size in [(-4.4, 4.5, 1.0), (-2.8, 5.0, 0.7), (2.5, 4.8, 1.1), (4.1, 4.1, 0.8)]:
        cube("Cave Stalactite", (x, 3.5, z), (size, 1.15, size * 1.8), dark, bevel=0.01)
    # A tiny stair bridge. Its last block sits slightly askew on purpose.
    bridge_blocks = []
    for i, (x, z) in enumerate([(-1.8, 0.28), (-0.9, 0.38), (0.0, 0.48), (0.9, 0.58)]):
        b = cube("Bridge Block " + str(i), (x, 1.15, z), (0.95, 0.9, 0.55), grass if i % 2 == 0 else stone, bevel=0.025)
        if i == 3:
            b.rotation_euler.z = math.radians(11)
        bridge_blocks.append(b)
    cube("Diamond Pedestal", (1.8, 0.45, 0.42), (1.05, 0.95, 0.78), obsidian, bevel=0.025)
    # Minecraft-style portal frame as a colorful original game prop.
    for x in (3.25, 4.25):
        cube("Portal Pillar", (x, 1.7, 1.65), (0.28, 0.36, 3.2), obsidian, bevel=0.01)
    for z in (0.25, 3.0):
        cube("Portal Lintel", (3.75, 1.7, z), (1.25, 0.36, 0.28), obsidian, bevel=0.01)
    cube("Portal Glow", (3.75, 1.73, 1.63), (0.72, 0.08, 2.35), m["portal"], bevel=0.015)
    # Floating ores and decorative cubes.
    for i, (x, y, z, mat) in enumerate([(-4.2, 0.7, 1.0, m["gold"]), (4.5, -1.2, 0.7, m["emerald"]), (-3.7, -2.0, 0.6, m["redstone"])]):
        cube("Floating Ore " + str(i), (x, y, z), (0.56, 0.56, 0.56), mat, bevel=0.02)
    # TNT prop with unmistakable red-and-white blocks.
    tnt = empty("TNT Charge", None, (-1.7, -0.45, 0.44))
    cube("TNT Crate", (0, 0, 0), (0.9, 0.9, 0.88), m["tnt"], tnt, 0.035)
    cube("TNT Stripe", (0, -0.465, 0.01), (0.78, 0.05, 0.24), m["white"], tnt, 0.005)
    text_obj("TNT Label", "TNT", (0, -0.5, 0.01), 0.18, m["dark"], tnt, rot=(math.pi / 2, 0, 0))
    return tnt, bridge_blocks


def block_world_roblox(m):
    cube("Obby Island", (0, 0, -0.5), (10.5, 8.5, 1.0), m["green"], bevel=0.03)
    cube("Island Side", (0, 0.1, -1.15), (9.6, 7.7, 0.45), m["deepgreen"], bevel=0.05)
    # Big, bright platforms make the course legible in a phone frame.
    for i, (x, y, z, color) in enumerate([(-1.15, 0.5, 0.55, m["cyan"]), (-0.65, 1.35, 1.0, m["pink"]), (-0.1, 2.0, 1.55, m["yellow"]), (0.55, 2.65, 2.05, m["purple"]), (1.25, 3.1, 2.45, m["orange"])]):
        cube("Obby Platform " + str(i), (x, y, z), (1.0, 0.9, 0.3), color, bevel=0.04)
        if i % 2 == 0:
            cube("Platform Glow " + str(i), (x, y, z - 0.17), (0.82, 0.75, 0.06), m["white"], bevel=0.02)
    # A bouncy pad and a ridiculous spinning gate.
    jump = cube("Jump Pad", (-1.2, -0.3, 0.12), (1.2, 1.0, 0.28), m["pink"], bevel=0.08)
    cube("Jump Pad Center", (-1.2, -0.3, 0.3), (0.64, 0.5, 0.07), m["white"], bevel=0.03)
    spinner = empty("Spinny Obby Rotor", None, (0.1, 0.7, 2.0))
    cube("Rotor Hub", (0, 0, 0), (0.32, 0.32, 0.32), m["white"], spinner, 0.04)
    cube("Rotor Bar", (0, 0, 0), (3.8, 0.19, 0.18), m["red"], spinner, 0.04)
    for x in (-1.75, 1.75):
        sphere("Rotor End", (x, 0, 0), 0.2, m["yellow"], spinner)
    # Finish arch, check point, and scoreboard.
    for x in (0.75, 1.85):
        cube("Finish Post", (x, 3.3, 1.45), (0.28, 0.28, 2.9), m["purple"], bevel=0.025)
    cube("Finish Beam", (1.3, 3.3, 2.88), (1.4, 0.3, 0.32), m["cyan"], bevel=0.035)
    text_obj("Finish Sign", "FINISH!", (1.3, 3.08, 2.95), 0.23, m["white"])
    checkpoint = cube("Checkpoint", (0.2, 0.25, 0.13), (0.82, 0.8, 0.25), m["yellow"], bevel=0.06)
    cube("Checkpoint Dot", (0.2, 0.25, 0.3), (0.38, 0.38, 0.06), m["white"], bevel=0.025)
    # Side towers and floating coins provide depth and game-world context.
    for x, y, z, color in [(-4.2, 2.6, 1.0, m["pink"]), (4.25, 0.9, 1.2, m["cyan"]), (-3.8, -1.6, 0.9, m["orange"]), (4.0, -1.9, 1.4, m["purple"])]:
        cube("Obby Tower", (x, y, z), (0.65, 0.65, 2.0), color, bevel=0.03)
    coins = []
    for i, x in enumerate((-1.1, -0.25, 0.65, 1.35)):
        coin = sphere("Floating Coin " + str(i), (x, 1.15, 3.2 + (i % 2) * 0.35), 0.25, m["yellow"])
        coin.scale = (1, 0.18, 1)
        coins.append(coin)
    return jump, spinner, checkpoint, coins


def setup_minecraft(args):
    m = {
        "grass": material("Grass Green", (0.16, 0.48, 0.13)),
        "grass2": material("Grass Pixel", (0.25, 0.61, 0.18)),
        "dirt": material("Dirt Brown", (0.30, 0.16, 0.09)),
        "stone": material("Stone", (0.28, 0.34, 0.4)),
        "darkstone": material("Deep Cave Rock", (0.08, 0.12, 0.19)),
        "lava": material("Lava", (1.0, 0.13, 0.015), emission=2.2),
        "yellow": material("Lava Gold", (1.0, 0.68, 0.04), emission=1.5),
        "obsidian": material("Obsidian", (0.12, 0.08, 0.29), metallic=0.15),
        "portal": material("Portal Violet", (0.45, 0.12, 0.95), emission=1.7),
        "gold": material("Gold Ore", (1.0, 0.66, 0.04), metallic=0.35),
        "emerald": material("Emerald Ore", (0.07, 0.8, 0.38), metallic=0.15),
        "redstone": material("Redstone Ore", (0.85, 0.09, 0.07), emission=0.5),
        "tnt": material("TNT Red", (0.85, 0.09, 0.055)),
        "white": material("Warm White", (0.94, 0.93, 0.83)),
        "dark": material("Face Dark", (0.055, 0.035, 0.03)),
        "skin": material("Adventurer Skin", (0.82, 0.52, 0.31)),
        "shirt": material("Steve Cyan Shirt", (0.02, 0.48, 0.56)),
        "shirt_dark": material("Steve Shirt Shadow", (0.025, 0.31, 0.39)),
        "pants": material("Steve Blue Pants", (0.07, 0.17, 0.40)),
        "pants_dark": material("Steve Pants Cuff", (0.045, 0.11, 0.29)),
        "hair": material("Steve Brown Hair", (0.075, 0.032, 0.018)),
        "boot": material("Boot Leather", (0.18, 0.085, 0.035)),
        "accent": material("Belt Gold", (0.98, 0.58, 0.1), metallic=0.25),
        "pack": material("Backpack", (0.49, 0.18, 0.08)),
        "wood": material("Pickaxe Wood", (0.34, 0.16, 0.065)),
        "iron": material("Pickaxe Iron", (0.61, 0.73, 0.83), metallic=0.75),
        "diamond": material("Diamond Gem", (0.1, 0.9, 0.94), metallic=0.3, emission=0.7),
        "boom": material("TNT Pop Glow", (1.0, 0.3, 0.015), emission=3.0),
        "pink": material("Pig Pink", (0.92, 0.38, 0.48)),
        "snout": material("Pig Snout Pink", (1.0, 0.59, 0.63)),
        "nostril": material("Pig Nostrils", (0.26, 0.08, 0.12)),
    }
    tnt, bridge_blocks = block_world_minecraft(m)
    hero = build_minecraft_steve("Steve", m)
    pig = build_pig({"pink": m["pink"], "snout": m["snout"], "nostril": m["nostril"], "dark": m["dark"]})
    hero["root"].location = (-2.4, -0.55, 0)
    pig["root"].location = (3.3, -0.45, 0)
    idle_cycle(hero, 1, TOTAL, period=92)
    idle_cycle(pig, 1, TOTAL, period=108)
    gem = make_diamond((1.8, 0.45, 1.3), m["diamond"], 0.78)
    pick = build_pickaxe(hero["arms"][1], m)
    fuse = sphere("Lit Fuse Spark", (-1.7, -0.45, 1.0), 0.12, m["yellow"])
    blast = sphere("TNT Cartoon Blast", (-1.7, -0.45, 0.85), 1.0, m["boom"])
    for i, bridge_block in enumerate(bridge_blocks):
        appear = 168 + i * 22
        key_scale(bridge_block, [(1, 0.001), (appear - 1, 0.001),
                                 (appear + 3, 1.12), (appear + 10, 1.0), (1440, 1.0)])
    # Staging keys: anticipation, impact, settle, then a final reaction.
    animate_vector(hero["root"], "location", [(1, (-2.4, -0.55, 0)), (120, (-1.4, -0.55, 0)), (280, (-0.4, -0.2, 0)), (390, (0.25, -0.1, 0)), (430, (0.25, -0.1, 0.2)), (455, (0.25, -0.1, 0)), (525, (-0.65, -0.4, 0)), (620, (-0.65, -0.4, 0)), (690, (-0.5, -0.3, 0.1)), (760, (-0.3, -0.4, 3.6)), (820, (0.5, -0.6, 2.7)), (870, (1.4, -0.6, 0)), (940, (1.4, -0.6, 0)), (1000, (-1.4, -0.55, 0)), (1120, (1.4, -0.55, 0)), (1210, (-0.7, -0.4, 0)), (1320, (-0.55, -0.5, 0)), (1440, (-0.55, -0.5, 0))])
    animate_vector(pig["root"], "location", [(1, (3.3, -0.45, 0)), (700, (3.3, -0.45, 0)), (760, (1.8, -0.25, 0)), (900, (1.8, -0.25, 0)), (960, (2.8, -0.5, 0)), (1060, (-1.3, -0.5, 0)), (1160, (1.6, -0.45, 0)), (1240, (0.25, -0.3, 0)), (1290, (0.25, -0.3, 0)), (1332, (0.45, -0.3, 0.55)), (1355, (0.45, -0.3, 0)), (1440, (0.45, -0.3, 0))])
    # Walk cycles only during motivated movement; they reset into clean holds.
    walk_cycle(hero, 115, 280, period=24, amount=0.42, bounce=0.045)
    walk_cycle(hero, 515, 620, period=15, amount=0.58, bounce=0.065)
    walk_cycle(hero, 930, 1210, period=13, amount=0.68, bounce=0.08)
    walk_cycle(pig, 745, 900, period=20, amount=0.38, bounce=0.04)
    walk_cycle(pig, 950, 1250, period=14, amount=0.5, bounce=0.06)
    pose(hero, 100, arm_l=-0.8, arm_r=0.8)
    pose(hero, 360, arm_l=-0.25, arm_r=-1.5, root_tilt=(0, 0, math.radians(2)))
    pose(hero, 430, arm_l=2.0, arm_r=-2.3, root_tilt=(math.radians(-23), 0, math.radians(-12)))
    pose(hero, 470, arm_l=0.4, arm_r=1.0, root_tilt=(0, 0, 0))
    pose(hero, 700, arm_l=-1.8, arm_r=1.8, root_tilt=(math.radians(8), 0, math.radians(-8)))
    pose(hero, 800, arm_l=2.8, arm_r=-2.4, root_tilt=(math.radians(30), 0, math.radians(9)))
    pose(hero, 870, arm_l=0.6, arm_r=0.7, root_tilt=(0, 0, 0))
    pose(hero, 1340, arm_l=-2.3, arm_r=-2.3)
    pose(pig, 1300, leg_l=0, leg_r=0)
    # Surprise mouth pops open at the tiny diamond, bonk, and sneeze beats.
    mouth = hero["open_mouth"]
    key_scale(mouth, [(1, 0.001), (310, 0.001), (325, 1), (355, 1), (365, 0.001), (420, 1), (470, 0.001), (1320, 1), (1350, 0.001)])
    # Pickaxe is hidden until the ridiculous reveal, then swings into the helmet.
    key_scale(pick, [(1, 0.001), (375, 0.001), (390, 1), (435, 1), (455, 0.001), (1440, 0.001)])
    for f, angle in [(390, -0.5), (410, 0.1), (430, 1.8), (450, 2.6), (455, 2.6)]:
        key(pick, "rotation_euler", f, (0, angle, 0))
    # The gem gets stolen, rides the pig, then boings onto Milo's forehead.
    animate_vector(gem, "location", [(1, (1.8, 0.45, 1.3)), (900, (1.8, 0.45, 1.3)), (930, (1.8, -0.35, 1.85)), (1060, (-1.3, -0.5, 1.65)), (1160, (1.6, -0.45, 1.6)), (1280, (0.45, -0.3, 1.9)), (1325, (-0.55, -0.52, 3.15)), (1340, (-0.55, -0.8, 2.8)), (1440, (-0.55, -0.8, 2.8))])
    key_scale(gem, [(1, 1), (300, 1), (320, 0.22), (1290, 0.22), (1325, 1.3), (1440, 1.3)])
    animate_vector(gem, "rotation_euler", [(1, (0, 0, 0)), (1325, (0, 0, 0)), (1340, (0.4, 0.7, 6.2)), (1360, (0, 0, 0)), (1440, (0, 0, 0))])
    # Fuse flickers, TNT squashes, then the hero gets launched with a clear arc.
    animate_vector(fuse, "location", [(1, (-1.7, -0.45, 1.0)), (600, (-1.7, -0.45, 1.0)), (690, (-1.7, -0.45, 1.2)), (715, (-1.7, -0.45, 1.5)), (730, (-1.7, -0.45, 2.0))])
    key_scale(fuse, [(1, 0.001), (650, 0.001), (690, 0.5), (710, 1.3), (730, 0.001)])
    animate_vector(blast, "location", [(1, (-1.7, -0.45, 0.85)), (705, (-1.7, -0.45, 0.85)), (725, (-1.7, -0.45, 0.95)), (760, (-1.7, -0.45, 0.95)), (780, (-1.7, -0.45, 0.95))])
    key_scale(blast, [(1, 0.001), (705, 0.001), (720, 0.9), (735, 2.1), (755, 0.001), (1440, 0.001)])
    key_scale(tnt, [(1, 1), (705, 1), (718, 1.08), (735, 0.001), (1440, 0.001)])
    # Animated cameras create visual grammar rather than one long follow shot.
    camera("01 Hook close-up", (-0.3, -12, 3.9), (-1.85, 0, 2.05), 5.4, 1, 70, 4.8)
    camera("02 Lava wide", (0, -17, 6.4), (0, 0.4, 2.35), 9.4, 70, 192, 8.8)
    camera("03 Bridge side", (0, -12, 4.8), (-0.4, 0.3, 2.0), 7.0, 192, 312, 6.5)
    camera("04 Tiny diamond insert", (1.1, -10.5, 4.0), (0.55, 0.1, 1.95), 5.8, 312, 384, 5.2)
    camera("05 Bonk close-up", (0, -10.8, 4.3), (0.0, -0.2, 2.05), 6.1, 384, 528, 5.6)
    camera("06 TNT low angle", (0.2, -14, 3.5), (-0.4, 0.2, 1.6), 8.3, 528, 720, 7.5)
    camera("07 Pig steals it", (0.4, -12, 7.2), (1.0, 0.2, 1.8), 8.2, 720, 936, 7.8)
    camera("08 Chase tracking", (0, -15, 6.0), (0, -0.1, 2.0), 8.2, 936, 1152, 7.6)
    camera("09 Portal whip", (4.3, -12, 4.2), (2.2, 0.7, 1.9), 7.8, 1152, 1296, 7.0)
    camera("10 Sneeze reaction", (0.1, -12, 4.5), (-0.3, -0.2, 2.0), 5.8, 1296, 1368, 5.3)
    camera("11 Winner pose", (0, -15, 5.2), (0.2, -0.2, 1.8), 7.5, 1368, 1441, 7.0)
    add_lighting("minecraft")
    return m


def setup_roblox(args):
    m = {
        "green": material("Island Green", (0.13, 0.54, 0.27)),
        "deepgreen": material("Island Edge", (0.05, 0.22, 0.15)),
        "cyan": material("Neon Cyan", (0.05, 0.68, 0.95), metallic=0.12, emission=0.25),
        "pink": material("Bubblegum Pink", (0.98, 0.14, 0.48), emission=0.18),
        "yellow": material("Coin Yellow", (1.0, 0.68, 0.05), metallic=0.1, emission=0.16),
        "purple": material("Neon Purple", (0.35, 0.12, 0.8), emission=0.15),
        "orange": material("Checkpoint Orange", (1.0, 0.32, 0.07)),
        "white": material("Bright White", (0.94, 0.96, 1.0)),
        "red": material("Rotor Red", (0.93, 0.055, 0.075)),
        "dark": material("Avatar Face", (0.045, 0.034, 0.055)),
        "skin": material("Noob Yellow", (1.0, 0.72, 0.15)),
        "shirt": material("Noob Classic Blue", (0.025, 0.27, 0.88)),
        "pants": material("Noob Classic Green", (0.11, 0.61, 0.16)),
        "boot": material("Shoe Gray", (0.18, 0.22, 0.3)),
        "accent": material("Noob Belt", (0.95, 0.78, 0.24)),
        "pack": material("Backpack Orange", (1.0, 0.3, 0.08)),
        "hat": material("Pro Cap", (0.05, 0.06, 0.11)),
        "shirtpro": material("Pro Hoodie", (0.08, 0.08, 0.16)),
        "pantspro": material("Pro Pants", (0.12, 0.15, 0.27)),
        "cyan2": material("Pro Accent", (0.02, 0.95, 0.92), emission=0.3),
        "spark": material("Star Spark", (1.0, 0.84, 0.12), emission=1.2),
    }
    jump_pad, spinner, checkpoint, coins = block_world_roblox(m)
    noob = build_roblox_r6("Classic Noob", m["shirt"], m["pants"], m["skin"], m["dark"], m["white"])
    pro = build_roblox_r6("Obby Pro", m["shirtpro"], m["pantspro"], m["skin"], m["dark"], m["white"], "visor")
    noob["root"].location = (-1.35, -0.8, 0)
    pro["root"].location = (-2.4, 0.15, 0)
    idle_cycle(noob, 1, TOTAL, period=82)
    idle_cycle(pro, 1, TOTAL, period=96)
    # Clear anticipation → rotor hit → seven readable turns → settle.
    animate_dense_vector(noob["root"], "location", [
        (1, (-1.35, -0.8, 0)), (160, (-1.35, -0.8, 0)),
        (270, (-0.95, -0.4, 0)), (300, (-0.75, -0.2, 0)),
        (330, (-0.62, -0.1, 0.08)), (360, (-0.54, -0.1, 0.45)),
        (420, (-0.58, -0.1, 0.28)), (480, (-0.55, -0.1, 0)),
        (530, (-0.55, -0.1, 0)), (650, (-1.2, -0.7, 0)),
        (720, (-1.2, -0.7, 0)), (760, (-1.2, -0.7, 0)),
        (800, (-0.9, -0.55, 0.8)), (840, (-0.5, -0.2, 2.7)),
        (880, (0, 0.4, 3.6)), (920, (0.5, 1.0, 2.7)),
        (970, (1.0, 1.8, 1.15)), (1008, (1.2, 2.35, 0.08)),
        (1020, (1.2, 2.4, 0)), (1100, (1.3, 2.4, 0)),
        (1440, (1.3, 2.4, 0)),
    ])
    yaw_frames = [(1, (0, 0, 0)), (329, (0, 0, 0)), (480, (0, 0, math.tau * 7)),
                  (760, (0, 0, math.tau * 7)), (800, (0, 0, math.tau * 7)),
                  (1440, (0, 0, math.tau * 7))]
    animate_dense_vector(noob["root"], "rotation_euler", yaw_frames)
    # Rotate the whole R6 rig around its center of mass for a readable flip;
    # rotating at the feet drove the head behind the platforms in the first pass.
    animate_dense_vector(noob["flip"], "rotation_euler", [
        (1, (0, 0, 0)), (780, (0, 0, 0)), (800, (0, 0, 0)),
        (850, (0, math.pi, 0)), (900, (0, math.tau, 0)),
        (1008, (0, math.tau, 0)), (1440, (0, math.tau, 0)),
    ])
    animate_vector(pro["root"], "location", [(1, (-2.4, 0.15, 0)), (650, (-2.4, 0.15, 0)),
                                                (800, (-2.25, 0.15, 0)), (950, (-1.5, 0.2, 0)),
                                                (1080, (0.4, 0.55, 0)), (1200, (0.8, 0.15, 0)),
                                                (1440, (0.8, 0.15, 0))])
    walk_cycle(noob, 270, 325, period=22, amount=0.45, bounce=0.045)
    walk_cycle(noob, 540, 650, period=24, amount=0.4, bounce=0.04)
    walk_cycle(pro, 630, 1080, period=20, amount=0.42, bounce=0.04)
    pose(noob, 100, arm_l=-1.9, arm_r=-1.9)
    pose(noob, 310, arm_l=2.4, arm_r=-2.4, leg_l=1.2, leg_r=-1.2)
    pose(noob, 330, arm_l=2.8, arm_r=-2.8, leg_l=1.5, leg_r=-1.5)
    pose(noob, 430, arm_l=2.4, arm_r=-2.4, leg_l=-1.1, leg_r=1.1)
    pose(noob, 480, arm_l=1.8, arm_r=-1.8, leg_l=-0.6, leg_r=0.6)
    pose(noob, 530, arm_l=-0.7, arm_r=-0.7, leg_l=0, leg_r=0)
    pose(noob, 650, arm_l=-2.4, arm_r=2.4)
    pose(noob, 760, arm_l=-0.5, arm_r=-0.5, leg_l=0.45, leg_r=-0.45)
    pose(noob, 800, arm_l=-2.6, arm_r=-2.6, leg_l=-0.7, leg_r=0.7)
    pose(noob, 850, arm_l=2.8, arm_r=-2.8, leg_l=1.3, leg_r=-1.3)
    pose(noob, 920, arm_l=2.1, arm_r=-2.1, leg_l=-0.8, leg_r=0.8)
    pose(noob, 1008, arm_l=2.8, arm_r=-2.6, leg_l=1.0, leg_r=-1.0)
    pose(noob, 1024, arm_l=-0.3, arm_r=-0.3, leg_l=0, leg_r=0)
    pose(noob, 1110, arm_l=-2.2, arm_r=-2.2, leg_l=0, leg_r=0)
    pose(noob, 1320, arm_l=-2.25, arm_r=-2.25)
    pose(pro, 1320, arm_l=-0.2, arm_r=0.2)
    animate_dense_vector(noob["body"], "rotation_euler", [
        (1, (0, 0, 0)), (300, (0, 0, 0)), (330, (-0.28, 0, 0)),
        (360, (0.18, 0, 0)), (480, (0, 0, 0)), (650, (0.02, 0, 0)),
        (760, (0.28, 0, 0)), (800, (-0.18, 0, 0)), (880, (0.12, 0, 0)),
        (1008, (0.32, 0, 0)), (1024, (-0.1, 0, 0)), (1060, (0, 0, 0)),
        (1440, (0, 0, 0)),
    ])
    key_scale(noob["body"], [(1, 1), (740, 1), (760, 0.90), (800, 1.06),
                             (840, 1), (990, 1), (1008, 0.82), (1016, 1.08),
                             (1030, 1), (1440, 1)])
    animate_vector(jump_pad, "location", [(1, (-1.2, -0.3, 0.12)), (720, (-1.2, -0.3, 0.12)),
                                            (755, (-1.2, -0.3, 0.42)), (778, (-1.2, -0.3, 0.12)),
                                            (820, (-1.2, -0.3, 0.12)), (1440, (-1.2, -0.3, 0.12))])
    key_scale(jump_pad, [(1, 1), (740, 1), (755, 0.82), (778, 1.12), (800, 1), (1440, 1)])
    # Rotor keeps spinning, checkpoint flashes, and a burst of celebratory cubes.
    animate_vector(spinner, "rotation_euler", [(1, (0, 0, 0)), (280, (0, 0, 0)),
                                                 (480, (0, 0, math.tau * 8)),
                                                 (900, (0, 0, math.tau * 16)),
                                                 (1440, (0, 0, math.tau * 24))])
    for f, s in [(1, 1), (530, 1), (545, 1.2), (560, 1), (610, 1), (625, 1.2), (640, 1)]:
        key(checkpoint, "scale", f, (s, s, s))
    confetti_mats = [m["pink"], m["cyan"], m["yellow"], m["purple"], m["orange"]]
    for i in range(28):
        x = -2.2 + (i % 7) * 0.72
        y = -0.2 + (i // 7) * 0.4
        z = 0.5 + (i % 4) * 0.35
        obj = cube("Confetti " + str(i), (x, y, z), (0.16, 0.16, 0.22), confetti_mats[i % len(confetti_mats)], bevel=0.025)
        key_scale(obj, [(1, 0.001), (1085, 0.001), (1090 + i % 6, 1), (1125 + i % 5, 1), (1200, 0.001), (1440, 0.001)])
        animate_vector(obj, "location", [(1, (x, y, z)), (1090, (x, y, z)), (1160, (x + (i % 5 - 2) * 0.45, y + (i % 3 - 1) * 0.35, z + 2.4)), (1200, (x + (i % 5 - 2) * 0.7, y + (i % 3 - 1) * 0.45, -0.5))])
        animate_vector(obj, "rotation_euler", [(1, (0, 0, 0)), (1090, (0, 0, 0)), (1160, (math.tau * (i % 3), math.tau * (i % 4), math.tau * 2))])
    camera("01 Noob claim", (-1.35, -10.5, 4.4), (-1.35, -0.2, 2.0), 5.8, 1, 96, 5.2)
    camera("02 Obby reveal", (-0.35, -17, 7.2), (-0.35, 0.8, 2.5), 10.2, 96, 240, 9.6)
    camera("03 Wrong way", (-3.8, -10, 4.2), (-0.7, -0.1, 1.8), 7.0, 240, 384, 6.6)
    camera("04 Rotor close-up", (-0.35, -11, 4.8), (-0.45, 0.25, 2.05), 6.8, 384, 552, 6.1)
    camera("05 Pro calm", (-1.9, -11, 4.2), (-1.8, 0, 1.9), 5.8, 552, 672, 5.2)
    camera("06 Jump pad", (-1.2, -13, 4.2), (-0.5, -0.1, 1.6), 7.8, 672, 816, 7.2)
    camera("07 Sky pinwheel", (0.2, -13.5, 7.6), (0.3, 0.6, 2.8), 8.2, 816, 1008, 7.2)
    camera("08 Accidental landing", (1.4, -11, 4.7), (1.2, 1.7, 1.8), 6.4, 1008, 1104, 5.8)
    camera("09 Finish reaction", (0.1, -15, 6.0), (0.8, 1.8, 1.9), 8.4, 1104, 1272, 7.4)
    camera("10 Victory pose", (0.7, -11.5, 4.5), (1.1, 1.7, 1.9), 5.8, 1272, 1441, 5.2)
    add_lighting("roblox")
    return m


def build_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = TOTAL
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = "FIXED"
    scene.render.threads = max(4, min(12, os.cpu_count() or 8))
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 64
    if args.kind == "minecraft":
        setup_minecraft(args)
    else:
        setup_roblox(args)
    frames_dir = os.path.splitext(args.output)[0] + "_frames"
    scene.render.filepath = os.path.join(frames_dir, "f_")
    scene.render.use_file_extension = True
    scene.frame_set(args.still if args.still else 1)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.blend)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    if args.still:
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = args.output
        bpy.ops.render.render(write_still=True)
    else:
        os.makedirs(frames_dir, exist_ok=True)
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    build_scene(parse_args())
