import pytest

from kosarica.sizes import package_size


@pytest.mark.parametrize(
    "name, size",
    [
        ("Hobby Dog mp govedina 1240 g", (1.24, "kg")),
        ("Dika Vino bijelo Sinergo bijeli 0,75L", (0.75, "l")),
        ("VRHNJE KIS.DUK.12%M.M.3x200 g", (0.6, "kg")),
        ("Dolcela inst.suhi kvasac 5x7g 1 gratis", (0.035, "kg")),
        ("Naturavita Čaj uvin H filter 20x1,5 g_OC", (0.03, "kg")),
        ("Tena Brašno oštro pšenično T-400 5kg_OC", (5.0, "kg")),
        ("Rauch Sok Happy day jabuka mango1L TETRA", (1.0, "l")),
        ("Karlovačko Pivo Radler limun 2% 0,5 l PB", (0.5, "l")),
        ("Nivea Sun Losion za sunčanje SPF30 400ml", (0.4, "l")),
        ("OME.SILAN FRESH SKY 1,408 L", (1.408, "l")),
        ("Coccolino Deter.za rub.Ult.c.37pr.1480ml", (1.48, "l")),
        ("KLC.Tuna komadi u vlast.soku 185g/135g", (0.185, "kg")),  # the drained weight is second
        ("Somat Det.za pos.All in One Extra 75/1", (75.0, "kom")),
        ("SALV PALOMA BOŽIĆ TREES 33X33 20/1", (20.0, "kom")),
        ("Jaja M 10 kom", (10.0, "kom")),
        ("VREĆE ZA SMEĆE UBOJI 60L 20/1", (20.0, "kom")),  # 60 L is what a bag holds
        ("SUPER MOČO VILEDA RESE S DRŠKOM 3D", None),
        ("BOŽ. LED ZVIJEZDA 30X30 CM 96 LAMPICA", None),
    ],
)
def test_package_size(name, size):
    assert package_size(name) == size
