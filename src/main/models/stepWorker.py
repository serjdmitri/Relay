# Fixed geometry operation; this worker never evaluates code from a STEP file.
import json, sys, os
import FreeCAD as App
import Part
cfg = json.load(sys.stdin)
shape = Part.Shape()
shape.read(cfg['input'])
if shape.isNull() or not shape.isValid():
    raise ValueError('The STEP shape is empty or invalid.')
before = shape.BoundBox
matrix = App.Matrix()
setattr(matrix, {'x': 'A11', 'y': 'A22', 'z': 'A33'}[cfg['axis']], cfg['factor'])
result = shape.transformGeometry(matrix)
if result.isNull() or not result.isValid():
    raise ValueError('The scaled shape is invalid; nothing was saved.')
result.exportStep(cfg['step'])
result.exportStl(cfg['stl'])
after = result.BoundBox
print('RELAY_RESULT '+json.dumps({'before':[before.XLength,before.YLength,before.ZLength], 'after':[after.XLength,after.YLength,after.ZLength]}), flush=True)
