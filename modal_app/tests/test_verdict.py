"""The verdict sent with the render 'done' callback: the deterministic verifier re-run on the shipped scene."""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gm_scenegen as sg  # noqa: E402

DESC = "Vector addition head to tail: a = (3, 1) plus b = (1, 2) gives a + b = (4, 3)."
IR = {'title': 'Adding vectors head to tail', 'vars': {'t': 0, 'ax': 3, 'ay': 1, 'bx': 1, 'by': 2, 'sumx': 'ax+bx', 'sumy': 'ay+by', 'tx': 'ax*t', 'ty': 'ay*t'}, 'objects': [{'type': 'point', 'id': 'O', 'at': [0, 0]}, {'type': 'point', 'id': 'A', 'on': 'grid', 'at': ['ax', 'ay']}, {'type': 'point', 'id': 'B', 'on': 'grid', 'at': ['bx', 'by']}, {'type': 'point', 'id': 'S', 'on': 'grid', 'at': ['sumx', 'sumy']}, {'type': 'point', 'id': 'B_start', 'on': 'grid', 'at': ['tx', 'ty']}, {'type': 'point', 'id': 'B_end', 'on': 'grid', 'at': ['tx+bx', 'ty+by']}, {'type': 'axes', 'id': 'grid', 'x': [-1, 6], 'y': [-1, 5], 'origin': 'O'}, {'type': 'vector', 'id': 'vec_a', 'from': 'O', 'to': 'A', 'color': 'a', 'label': 'a'}, {'type': 'vector', 'id': 'vec_b', 'from': 'B_start', 'to': 'B_end', 'color': 'b', 'label': 'b'}, {'type': 'vector', 'id': 'vec_sum', 'from': 'O', 'to': 'S', 'color': 'highlight', 'label': 'a + b'}, {'type': 'vector', 'id': 'para_a', 'from': 'B', 'to': 'S', 'color': 'a', 'dashed': True}, {'type': 'readout', 'id': 'ro', 'text': 'a + b = ({sumx}, {sumy})'}], 'constraints': [], 'checks': [['eq', 'sumx', 4], ['eq', 'sumy', 3]], 'beats': [{'say': 'Here are two vectors, a and b, starting from the origin.', 'do': [['show', 'grid', 'vec_a', 'vec_b', 'ro']]}, {'say': 'Slide vector b so its tail meets the tip of vector a.', 'do': [['animate', 't', 1, {'run': 2, 'rate': 'smooth'}]]}, {'say': 'The sum vector goes directly from the origin to the new tip.', 'do': [['show', 'vec_sum'], ['highlight', 'vec_sum']]}, {'say': 'Completing the dashed lines forms a parallelogram.', 'do': [['show', 'para_a']]}]}


def test_verdict_ok_for_a_sound_scene():
    v = sg.final_verdict(DESC, sg.normalize(copy.deepcopy(IR)))
    assert v["ok"] is True and v["failed"] == [] and v["verifier"] == "scene-ir"


def test_verdict_fails_a_scene_whose_check_breaks():
    bad = copy.deepcopy(IR)
    bad["vars"]["bx"] = 5
    v = sg.final_verdict(DESC, sg.normalize(bad))
    assert v["ok"] is False and v["failed"]
