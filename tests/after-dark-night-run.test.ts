import { describe, expect, it } from "vitest";
import { settlePlace, shownMove } from "@/lib/adult/continuity";

// The two-chapter test night on prod, 2026-10-26 (Sweet thang × Dex): what it caught.
const NAMES = { a: "Sweet thang", b: "Dex Okafor" };
const l = (who: "a" | "b", text: string) => ({ who, text });

describe("getting out of their clothes isn't leaving", () => {
  // Lines 27 to 42 as written: they walk to his flat, she undresses him, "steps out of the pooled fabric", and the night
  // was moved to the street (an automatic picture of them there, mid-undress).
  const night = [
    l("a", "*She stands and smooths her dress, watching him.* My brave, gentle giant. Are you going to clear a path for me?"),
    l("b", "*He takes her hand, his grip firm but gentle, and threads them through the tables.* Something like that. My apartment is just two blocks up."),
    l("a", "*She squeezes his hand as they push through the heavy door.* Two whole blocks? That's practically a world tour for you. I hope your quiet place is worth the trek."),
    l("b", "*He unlocks a simple apartment door and pushes it open.* It's just clay. And very good coffee."),
    l("a", "*She lets go of his hand, stepping past him into the dimly lit room.* Clay and coffee. How. rustic. So this is where you hide from the world."),
    l("b", "*He closes the door softly, the click loud in the sudden silence.* The coffee is instant, but it's good. I can put a pot on if you want."),
    l("a", "*She turns back to him, her eyes sweeping from his face down to his worn jeans.* Forget the coffee. I'm thirsty for something else entirely."),
    l("b", "*He stands very still, his hands hanging loosely at his sides.* Oh. Okay then."),
    l("a", "*She closes the distance, her fingers finding the top button of his shirt.* Good boy. A quiet room is perfect for making a little noise of our own."),
    l("b", "*His breath hitches as her knuckles brush against his chest.* What about you? Are you always this."),
    l("a", "*She works his shirt open, her nails scraping lightly down his chest to his belt.* Forward? In charge? Yes. I'm always exactly what the moment needs."),
    l("b", "*His head tips back, a low groan catching in his throat as she touches his stomach.* Okay. Yeah. That's. exactly what I need right now."),
    l("a", "*She pushes the shirt off his shoulders, letting it fall to the floor, and unbuckles his belt.* God, look at you. All this strength, just waiting for a cue. Now take my dress off. Slowly."),
    l("b", "*His fingers, usually sure with clay, fumble slightly with the tiny hook at the top of her zipper.* Alright. I can do that. Just. give me a second here."),
    l("a", "*She shimmies out of the dress as he gets the zipper down, and steps out of the pooled fabric at her feet.* There. Now get on that couch. I want to see what all that careful power looks like when it's not holding back."),
    l("b", "*He backs up until his knees hit the worn corduroy of the sofa and sits, his gaze fixed on her naked body.* Show me what you want to see."),
  ];
  const from = 10;

  it("in his flat, stepping out of her dress keeps them there", () => {
    expect(shownMove(night, from, "his apartment", NAMES)).toBeNull();
    const r = settlePlace({ current: { place: "Dex Okafor's apartment", set: "his apartment" }, claimed: { place: "his apartment", set: null }, lines: night, from, movesThisChapter: 1, homeNow: "b", names: NAMES, fromLines: true });
    expect(r.moved).toBeNull();
    expect(r.set).toBe("his apartment");
  });

  it("a claim of the street from his flat needs one of them to ask to go out", () => {
    const r = settlePlace({ current: { place: "Dex Okafor's apartment", set: "his apartment" }, claimed: { place: "the street", set: null }, lines: night, from, movesThisChapter: 1, homeNow: "b", names: NAMES, fromLines: true });
    expect(r.moved).toBeNull();
  });

  it("still leaves a bar when one asks to get out and they walk out", () => {
    const lines = [l("a", "*leans in* Let's get out of here."), l("b", "Yes. Let's go."), l("a", "*leads him out of the bar into the night*")];
    expect(shownMove(lines, 0, "the jazz bar", NAMES)?.to).toBe("the street");
  });
});

describe("an invitation home, in the home's own word", () => {
  // Run 2 (Sweet thang × Juniper): "My penthouse has better acoustics", then out of the bar, up in the lift, the door
  // unlocked, and every arrival at her place refused for fifty lines, held at kissing in a bar they'd left.
  const night = [
    l("a", "*Her hand stills, and she glances around the dark bar.* This backstage is too crowded. My penthouse has better acoustics for that kind of broadcast."),
    l("b", "*Her gaze stays locked on Sweet as she steps back.* A penthouse. A different kind of echo. High altitude."),
    l("a", "*A slow, triumphant smile spreads across her face as she takes Juniper's hand.* Exactly. No gulls. Just me."),
    l("b", "*As they walk towards the exit, she undoes the top button of Sweet's jacket.* That coat would block the cross-breeze."),
    l("a", "*She shrugs the jacket from her shoulders, letting it fall over an empty chair.* Good. The noise stays here then."),
    l("b", "*She lets the oversized storm coat slide from her shoulders to the floor.* The lamp is still on."),
    l("a", "*She takes Juniper's hand again, pulling her toward the stairs to the street.* That lamp is taking an elevator. Let's go."),
    l("b", "*Glances back at the drummer.* He'll think it's a haunting. A sudden disappearance."),
    l("a", "*Tugs Juniper's hand, leading her up the stairs.* Let him. The real haunting is just getting started."),
    l("b", "*Steps out of the elevator into a quiet, carpeted hallway.* No wind up here. The air is still."),
    l("a", "*Unlocks the door and pushes it open.* I can make some. Or we can just make our own weather."),
  ];
  it("\"my penthouse\" is an invitation home, and arriving there takes them there", () => {
    const bar = "A basement jazz bar, one table left";
    const r = settlePlace({ current: { place: bar, set: bar }, claimed: { place: "Sweet's place", set: null }, lines: night, from: 6, movesThisChapter: 1, homeNow: null, names: { a: "Sweet thang", b: "Juniper Vale" }, fromLines: true, locked: true });
    expect(r.moved).toMatchObject({ home: "a" });
  });
});
