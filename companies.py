"""
Companies, as objects.

cark cannot understand a company. it can understand a warm rectangle, a box that
arrives, a round thing that moves on its own. every entry here is anchored to a
real, physical, true thing the company makes, so cark's misreading is grounded in
something rather than invented.

`thing` must be TRUE. that is the whole constraint. the comedy is the category
error, not a wrong fact.

`opaque` marks companies with no object a cat could ever encounter. cark is
allowed to simply fail to find those, which is funnier than pretending.
"""

COMPANIES = [
    # things that are warm, and therefore matter
    {"t": "NVDA", "n": "nvidia",
     "thing": "makes the chips that draw images on screens and run ai",
     "cat": "the chip gets hot, and warm flat things are for sitting on"},
    {"t": "AAPL", "n": "apple",
     "thing": "makes phones and laptops",
     "cat": "a laptop is a warm rectangle that objects to being sat on"},
    {"t": "INTC", "n": "intel",
     "thing": "makes computer processors",
     "cat": "another one that makes the warm part of the warm thing"},
    {"t": "AMD", "n": "amd",
     "thing": "makes computer processors and graphics chips",
     "cat": "indistinguishable from the other one as far as cark is concerned"},

    # boxes. the most important industry on earth
    {"t": "AMZN", "n": "amazon",
     "thing": "delivers packages in cardboard boxes",
     "cat": "the box is the product. whatever is inside it is packaging"},
    {"t": "FDX", "n": "fedex",
     "thing": "delivers packages",
     "cat": "brings boxes but does not stay"},
    {"t": "COST", "n": "costco",
     "thing": "sells things in very large quantities",
     "cat": "everything there is in a size a cat could not move"},

    # the ones that concern a cat directly
    {"t": "CHWY", "n": "chewy",
     "thing": "sells pet food and pet supplies online",
     "cat": "this one is about cark specifically and cark has noticed"},
    {"t": "NSRGY", "n": "nestle",
     "thing": "owns purina, which makes cat food",
     "cat": "the food comes from somewhere and this is the somewhere"},
    {"t": "IRBT", "n": "irobot",
     "thing": "makes the roomba, a round robot that vacuums floors by itself",
     "cat": "a round thing that moves on its own. an ongoing situation"},
    {"t": "PFE", "n": "pfizer",
     "thing": "makes medicines and vaccines",
     "cat": "medicine means the vet. the vet is not a thing cark discusses"},

    # loud, distant, or moving
    {"t": "TSLA", "n": "tesla",
     "thing": "makes electric cars, which are very quiet",
     "cat": "a car you cannot hear coming is a personal problem"},
    {"t": "BA", "n": "boeing",
     "thing": "makes passenger aircraft",
     "cat": "the loud far away one that goes across the window"},
    {"t": "F", "n": "ford",
     "thing": "makes cars and trucks",
     "cat": "makes the warm one that sits outside and ticks after it stops"},
    {"t": "DAL", "n": "delta",
     "thing": "runs an airline",
     "cat": "puts animals in the part of the plane with no windows. noted"},
    {"t": "SPCX", "n": "spacex",
     "thing": "builds reusable rockets and runs the starlink satellite network",
     "cat": "the thing that leaves, and the little ones that stay up there"},

    # screens and sounds
    {"t": "MSFT", "n": "microsoft",
     "thing": "makes windows, office software and the xbox",
     "cat": "responsible for the clicking noise the human makes all day"},
    {"t": "GOOGL", "n": "google",
     "thing": "runs the search engine most people use to find things",
     "cat": "for finding things. cark has never lost anything"},
    {"t": "META", "n": "meta",
     "thing": "runs facebook and instagram, for looking at people you know",
     "cat": "cark knows one person and he is already here"},
    {"t": "NFLX", "n": "netflix",
     "thing": "streams films and television",
     "cat": "a window with nothing real behind it"},
    {"t": "DIS", "n": "disney",
     "thing": "makes films and runs theme parks",
     "cat": "none of the cats in them are real cats"},
    {"t": "NTDOY", "n": "nintendo",
     "thing": "makes video games and consoles",
     "cat": "small hands moving on a small thing, for hours, for nothing"},
    {"t": "SPOT", "n": "spotify",
     "thing": "streams music",
     "cat": "makes the house make noise when nobody is making noise"},

    # food and drink for the wrong species
    {"t": "SBUX", "n": "starbucks",
     "thing": "sells coffee",
     "cat": "hot bitter water. warm though, which is the only part that counts"},
    {"t": "MCD", "n": "mcdonalds",
     "thing": "runs fast food restaurants",
     "cat": "a food building with nothing in it for a cat"},
    {"t": "KO", "n": "coca cola",
     "thing": "makes fizzy drinks",
     "cat": "brown water that hisses. cark has knocked one over"},
    {"t": "SBUX2", "n": "chipotle", "t_override": "CMG",
     "thing": "sells burritos",
     "cat": "food wrapped in a blanket, which cark respects structurally"},

    # things a cat can walk on
    {"t": "NKE", "n": "nike",
     "thing": "makes shoes and sportswear",
     "cat": "cark has slept in one"},
    {"t": "HD", "n": "home depot",
     "thing": "sells building materials and tools",
     "cat": "sells wood and, more importantly, boxes"},
    {"t": "WMT", "n": "walmart",
     "thing": "runs very large shops that sell almost everything",
     "cat": "too big. too bright. everything is up high"},

    # nothing a cat could ever find
    {"t": "BRK.B", "n": "berkshire hathaway",
     "thing": "owns pieces of a lot of other companies",
     "cat": "there is no object. cark has looked", "opaque": True},
    {"t": "JPM", "n": "jpmorgan",
     "thing": "is a bank",
     "cat": "a building where nothing is made", "opaque": True},
    {"t": "V", "n": "visa",
     "thing": "moves card payments between banks",
     "cat": "no object at all. cark cannot get hold of this one", "opaque": True},
    {"t": "GS", "n": "goldman sachs",
     "thing": "is an investment bank",
     "cat": "cark has been looking for the thing it makes", "opaque": True},
]

for _c in COMPANIES:
    if "t_override" in _c:
        _c["t"] = _c.pop("t_override")

BY_NAME = {c["n"]: c for c in COMPANIES}
BY_TICKER = {c["t"].lower(): c for c in COMPANIES}


def find_company(text):
    """A company named in a piece of text, or None."""
    low = (text or "").lower()
    for c in COMPANIES:
        if c["n"] in low:
            return c
    words = set(w.strip("$.,!?()").lower() for w in low.split())
    for tick, c in BY_TICKER.items():
        if tick in words or ("$" + tick) in low:
            return c
    return None
