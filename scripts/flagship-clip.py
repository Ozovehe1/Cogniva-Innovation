# Manim clip for the flagship sample lesson (src/lib/flagship-lesson.ts, section 3).
# Timed to the Kokoro narration of that step (18.05 s): "Here's the idea as a short animation.
# Split the throw into two motions. Sideways, ... Up and down, gravity ... Put the two together,
# and the path is a parabola." Rendered once on the Modal service; stored at
# manim-clips/examples/ball-flight/1.mp4.
from manim import *
import numpy as np

BG = "#FDFCF9"; INK = "#14141A"; MUTED = "#6B6B73"; RULE = "#D9D6CE"; GREEN = "#1F4D3A"; CLAY = "#A4502A"; NAVY = "#23406A"; AMBER = "#B7862C"

VX = 2.6
VY = 4.0
G = 8.0 / 3.0
T_LAND = 3.0
ORIGIN = np.array([-4.5, -3.0, 0.0])
TRACK_Y = 2.3
TRACK_X = -5.8


def pos(t):
    return ORIGIN + np.array([VX * t, VY * t - 0.5 * G * t * t, 0.0])


class GeneratedScene(Scene):
    def construct(self):
        self.camera.background_color = BG
        title = Text("One throw, two motions", font_size=34, color=INK).to_edge(UL, buff=0.5)
        ground = Line(np.array([-6.4, -3.0, 0]), np.array([6.4, -3.0, 0]), color=MUTED, stroke_width=2)
        ball = Dot(pos(0), radius=0.13, color=GREEN)
        # 0.0 - 2.9  "Here's the idea as a short animation."
        self.play(Write(title), Create(ground), FadeIn(ball, shift=0.2 * UP), run_time=1.8)
        self.wait(1.1)

        # 2.9 - 5.3  "Split the throw into two motions."
        ax = Arrow(pos(0), pos(0) + np.array([1.6, 0, 0]), buff=0, color=NAVY, stroke_width=4, max_tip_length_to_length_ratio=0.18)
        ay = Arrow(pos(0), pos(0) + np.array([0, 2.2, 0]), buff=0, color=CLAY, stroke_width=4, max_tip_length_to_length_ratio=0.15)
        lx = Text("sideways", font_size=24, color=NAVY).next_to(ax, DOWN, buff=0.15)
        ly = Text("up and down", font_size=24, color=CLAY).next_to(ay, LEFT, buff=0.15)
        self.play(GrowArrow(ax), GrowArrow(ay), run_time=1.0)
        self.play(FadeIn(lx, shift=0.2 * UP), FadeIn(ly, shift=0.2 * UP), run_time=0.6)
        self.wait(0.8)

        # 5.3 - 9.9  "Sideways, the ball keeps the same speed, because nothing pushes it sideways."
        track = DashedLine(np.array([pos(0)[0], TRACK_Y, 0]), np.array([pos(T_LAND)[0], TRACK_Y, 0]), color=RULE, stroke_width=2)
        tx = ValueTracker(0.0)
        hdot = always_redraw(lambda: Dot(np.array([pos(tx.get_value())[0], TRACK_Y, 0]), radius=0.1, color=NAVY))
        harrow = always_redraw(lambda: Arrow(np.array([pos(tx.get_value())[0], TRACK_Y, 0]), np.array([pos(tx.get_value())[0] + 1.2, TRACK_Y, 0]), buff=0, color=NAVY, stroke_width=4, max_tip_length_to_length_ratio=0.2))
        ticks = VGroup(*[Line(np.array([pos(k * 0.5)[0], TRACK_Y - 0.12, 0]), np.array([pos(k * 0.5)[0], TRACK_Y + 0.12, 0]), color=MUTED, stroke_width=2) for k in range(7)])
        self.play(FadeOut(lx), FadeOut(ly), Create(track), FadeIn(hdot), FadeIn(harrow), run_time=0.6)
        self.play(tx.animate.set_value(T_LAND), Create(ticks, lag_ratio=1.0), run_time=3.6, rate_func=linear)
        self.wait(0.4)

        # 9.9 - 14.9  "Up and down, gravity slows it, stops it, and pulls it back, exactly as before."
        vtrack = DashedLine(np.array([TRACK_X, -3.0, 0]), np.array([TRACK_X, pos(1.5)[1] + 0.2, 0]), color=RULE, stroke_width=2)
        ty = ValueTracker(0.0)
        vdot = always_redraw(lambda: Dot(np.array([TRACK_X, pos(ty.get_value())[1], 0]), radius=0.1, color=CLAY))

        def varrow():
            t = ty.get_value()
            v = VY - G * t
            p = np.array([TRACK_X, pos(t)[1], 0])
            if abs(v) < 0.08:
                return VGroup()
            return Arrow(p, p + np.array([0, 0.45 * v, 0]), buff=0, color=CLAY, stroke_width=4, max_tip_length_to_length_ratio=0.25)

        vel = always_redraw(varrow)
        self.play(FadeOut(ax), FadeOut(ay), Create(vtrack), FadeIn(vdot), run_time=0.5)
        self.add(vel)
        self.play(ty.animate.set_value(T_LAND), run_time=4.3, rate_func=linear)
        self.remove(vel)
        self.wait(0.2)

        # 14.9 - 18.05  "Put the two together, and the path is a parabola."
        tx.set_value(0.0)
        ty.set_value(0.0)
        tt = ValueTracker(0.0)
        ball.add_updater(lambda m: m.move_to(pos(tt.get_value())))
        tx.add_updater(lambda m: m.set_value(tt.get_value()))
        ty.add_updater(lambda m: m.set_value(tt.get_value()))
        trail = TracedPath(ball.get_center, stroke_color=GREEN, stroke_width=3)
        guides = always_redraw(lambda: VGroup(
            DashedLine(np.array([pos(tt.get_value())[0], TRACK_Y, 0]), pos(tt.get_value()), color=NAVY, stroke_width=1.5, dash_length=0.08),
            DashedLine(np.array([TRACK_X, pos(tt.get_value())[1], 0]), pos(tt.get_value()), color=CLAY, stroke_width=1.5, dash_length=0.08),
        ))
        self.add(trail, guides, tx, ty)
        self.play(tt.animate.set_value(T_LAND), run_time=2.4, rate_func=linear)
        ball.clear_updaters()
        label = Text("a parabola", font_size=30, color=GREEN).move_to(pos(1.5) + np.array([0, 0.55, 0]))
        self.play(FadeOut(guides), Write(label), run_time=0.5)
        self.play(Indicate(label, color=AMBER, scale_factor=1.08), run_time=0.5)
