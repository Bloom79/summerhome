package dev.colorgap.colorcore

/** A named reference color. */
class NamedColor(val hex: String, val english: String, val italian: String) {
    val argb: Int = Argb.fromHex(hex)
    val lab: Lab = CieLab.fromArgb(argb)

    fun name(language: String): String = if (language == "it") italian else english
}

/** Result of [ColorNames.nearest]. */
data class ColorMatch(val color: NamedColor, val deltaE: Double)

/**
 * Small dictionary of everyday color names in English and Italian, matched by
 * perceptual distance (ΔE2000). Deliberately limited to names a person would
 * actually use ("olive green", not "papaya whip").
 */
object ColorNames {
    val all: List<NamedColor> = listOf(
        // Neutrals
        NamedColor("#000000", "Black", "Nero"),
        NamedColor("#36454F", "Charcoal", "Antracite"),
        NamedColor("#555555", "Dark gray", "Grigio scuro"),
        NamedColor("#808080", "Gray", "Grigio"),
        NamedColor("#C0C0C0", "Silver", "Argento"),
        NamedColor("#D3D3D3", "Light gray", "Grigio chiaro"),
        NamedColor("#FFFFFF", "White", "Bianco"),
        NamedColor("#FFFFF0", "Ivory", "Avorio"),
        NamedColor("#FFFDD0", "Cream", "Crema"),
        NamedColor("#F5F5DC", "Beige", "Beige"),
        NamedColor("#708090", "Slate gray", "Grigio ardesia"),
        NamedColor("#2F4F4F", "Dark slate gray", "Grigio ardesia scuro"),
        NamedColor("#483C32", "Taupe", "Talpa"),
        // Reds
        NamedColor("#FF0000", "Red", "Rosso"),
        NamedColor("#DC143C", "Crimson", "Cremisi"),
        NamedColor("#B22222", "Brick red", "Rosso mattone"),
        NamedColor("#8B0000", "Dark red", "Rosso scuro"),
        NamedColor("#800000", "Maroon", "Bordeaux"),
        NamedColor("#722F37", "Wine", "Vinaccia"),
        NamedColor("#960018", "Carmine", "Carminio"),
        NamedColor("#E34234", "Vermilion", "Vermiglione"),
        NamedColor("#FF6347", "Tomato red", "Rosso pomodoro"),
        NamedColor("#CD5C5C", "Indian red", "Rosso indiano"),
        NamedColor("#E0115F", "Ruby", "Rubino"),
        NamedColor("#E30B5C", "Raspberry", "Lampone"),
        // Oranges
        NamedColor("#FFA500", "Orange", "Arancione"),
        NamedColor("#FF8C00", "Dark orange", "Arancione scuro"),
        NamedColor("#FF4500", "Orange red", "Rosso arancio"),
        NamedColor("#ED9121", "Carrot orange", "Carota"),
        NamedColor("#FFBF00", "Amber", "Ambra"),
        NamedColor("#FF7F50", "Coral", "Corallo"),
        NamedColor("#F08080", "Light coral", "Corallo chiaro"),
        NamedColor("#FA8072", "Salmon", "Salmone"),
        NamedColor("#FBCEB1", "Apricot", "Albicocca"),
        NamedColor("#FFE5B4", "Peach", "Pesca"),
        NamedColor("#B7410E", "Rust", "Ruggine"),
        NamedColor("#B87333", "Copper", "Rame"),
        // Browns
        NamedColor("#964B00", "Brown", "Marrone"),
        NamedColor("#A52A2A", "Red brown", "Rosso bruno"),
        NamedColor("#8B4513", "Saddle brown", "Marrone cuoio"),
        NamedColor("#A0522D", "Sienna", "Terra di Siena"),
        NamedColor("#E97451", "Burnt sienna", "Terra di Siena bruciata"),
        NamedColor("#8A3324", "Burnt umber", "Terra d'ombra bruciata"),
        NamedColor("#635147", "Umber", "Terra d'ombra"),
        NamedColor("#654321", "Dark brown", "Marrone scuro"),
        NamedColor("#3D2B1F", "Very dark brown", "Testa di moro"),
        NamedColor("#D2691E", "Chocolate", "Cioccolato"),
        NamedColor("#6F4E37", "Coffee", "Caffè"),
        NamedColor("#A67B5B", "Café au lait", "Caffellatte"),
        NamedColor("#CD853F", "Light brown", "Marrone chiaro"),
        NamedColor("#C19A6B", "Camel", "Cammello"),
        NamedColor("#D2B48C", "Tan", "Nocciola chiaro"),
        NamedColor("#DEB887", "Light wood", "Legno chiaro"),
        NamedColor("#C2B280", "Sand", "Sabbia"),
        NamedColor("#C68E17", "Caramel", "Caramello"),
        NamedColor("#CC7722", "Ochre", "Ocra"),
        // Yellows
        NamedColor("#FFFF00", "Yellow", "Giallo"),
        NamedColor("#FFF700", "Lemon yellow", "Giallo limone"),
        NamedColor("#FFFF99", "Pale yellow", "Giallo pallido"),
        NamedColor("#FFD700", "Gold", "Oro"),
        NamedColor("#F4C430", "Saffron", "Zafferano"),
        NamedColor("#E1AD01", "Mustard", "Senape"),
        NamedColor("#DAA520", "Goldenrod", "Ocra dorata"),
        NamedColor("#FADA5E", "Naples yellow", "Giallo Napoli"),
        NamedColor("#F0E68C", "Khaki", "Cachi"),
        NamedColor("#BDB76B", "Dark khaki", "Cachi scuro"),
        // Greens
        NamedColor("#00FF00", "Bright green", "Verde brillante"),
        NamedColor("#32CD32", "Lime green", "Verde lime"),
        NamedColor("#7CFC00", "Lawn green", "Verde prato"),
        NamedColor("#7FFF00", "Chartreuse", "Verde chartreuse"),
        NamedColor("#9ACD32", "Yellow green", "Verde giallastro"),
        NamedColor("#008000", "Green", "Verde"),
        NamedColor("#006400", "Dark green", "Verde scuro"),
        NamedColor("#228B22", "Forest green", "Verde foresta"),
        NamedColor("#2E8B57", "Sea green", "Verde mare"),
        NamedColor("#90EE90", "Light green", "Verde chiaro"),
        NamedColor("#98FB98", "Pale green", "Verde pallido"),
        NamedColor("#D0F0C0", "Tea green", "Verde tè"),
        NamedColor("#808000", "Olive", "Oliva"),
        NamedColor("#6B8E23", "Olive green", "Verde oliva"),
        NamedColor("#556B2F", "Dark olive green", "Verde oliva scuro"),
        NamedColor("#8A9A5B", "Moss green", "Verde muschio"),
        NamedColor("#9DC183", "Sage", "Salvia"),
        NamedColor("#4F7942", "Fern green", "Verde felce"),
        NamedColor("#01796F", "Pine green", "Verde pino"),
        NamedColor("#50C878", "Emerald", "Smeraldo"),
        NamedColor("#00A86B", "Jade", "Giada"),
        NamedColor("#3EB489", "Mint", "Menta"),
        // Cyans and teals
        NamedColor("#00FFFF", "Cyan", "Ciano"),
        NamedColor("#E0FFFF", "Light cyan", "Ciano chiaro"),
        NamedColor("#40E0D0", "Turquoise", "Turchese"),
        NamedColor("#00CED1", "Dark turquoise", "Turchese scuro"),
        NamedColor("#AFEEEE", "Pale turquoise", "Turchese pallido"),
        NamedColor("#7FFFD4", "Aquamarine", "Acquamarina"),
        NamedColor("#20B2AA", "Aqua green", "Verde acqua"),
        NamedColor("#008080", "Teal", "Ottanio"),
        NamedColor("#005F6A", "Petrol blue", "Blu petrolio"),
        // Blues
        NamedColor("#0000FF", "Blue", "Blu"),
        NamedColor("#00008B", "Dark blue", "Blu scuro"),
        NamedColor("#000080", "Navy blue", "Blu marina"),
        NamedColor("#191970", "Midnight blue", "Blu notte"),
        NamedColor("#003153", "Prussian blue", "Blu di Prussia"),
        NamedColor("#4169E1", "Royal blue", "Blu reale"),
        NamedColor("#0047AB", "Cobalt blue", "Blu cobalto"),
        NamedColor("#0F52BA", "Sapphire", "Zaffiro"),
        NamedColor("#3F00FF", "Ultramarine", "Blu oltremare"),
        NamedColor("#1560BD", "Denim", "Blu jeans"),
        NamedColor("#4682B4", "Steel blue", "Blu acciaio"),
        NamedColor("#6495ED", "Cornflower blue", "Blu fiordaliso"),
        NamedColor("#6A5ACD", "Slate blue", "Blu ardesia"),
        NamedColor("#007FFF", "Azure", "Azzurro"),
        NamedColor("#00BFFF", "Deep sky blue", "Azzurro intenso"),
        NamedColor("#87CEEB", "Sky blue", "Azzurro cielo"),
        NamedColor("#ADD8E6", "Light blue", "Azzurro chiaro"),
        NamedColor("#B0E0E6", "Powder blue", "Azzurro polvere"),
        NamedColor("#CCCCFF", "Periwinkle", "Pervinca"),
        // Purples
        NamedColor("#800080", "Purple", "Viola"),
        NamedColor("#9400D3", "Dark violet", "Viola scuro"),
        NamedColor("#EE82EE", "Violet", "Violetto"),
        NamedColor("#8A2BE2", "Blue violet", "Blu violetto"),
        NamedColor("#4B0082", "Indigo", "Indaco"),
        NamedColor("#DA70D6", "Orchid", "Orchidea"),
        NamedColor("#E6E6FA", "Lavender", "Lavanda"),
        NamedColor("#C8A2C8", "Lilac", "Lilla"),
        NamedColor("#C9A0DC", "Wisteria", "Glicine"),
        NamedColor("#9966CC", "Amethyst", "Ametista"),
        NamedColor("#8E4585", "Plum", "Prugna"),
        NamedColor("#614051", "Aubergine", "Melanzana"),
        NamedColor("#FF00FF", "Magenta", "Magenta"),
        // Pinks
        NamedColor("#FFC0CB", "Pink", "Rosa"),
        NamedColor("#FFB6C1", "Light pink", "Rosa chiaro"),
        NamedColor("#F4C2C2", "Powder pink", "Rosa cipria"),
        NamedColor("#C08081", "Old rose", "Rosa antico"),
        NamedColor("#FF69B4", "Hot pink", "Rosa acceso"),
        NamedColor("#FF1493", "Deep pink", "Rosa intenso"),
        NamedColor("#FF007F", "Shocking pink", "Rosa shocking"),
        NamedColor("#F400A1", "Fuchsia", "Fucsia"),
        NamedColor("#FC8EAC", "Flamingo pink", "Rosa fenicottero"),
        NamedColor("#F88379", "Coral pink", "Rosa corallo"),
    )

    /** The perceptually closest named color. */
    fun nearest(argb: Int): ColorMatch {
        val lab = CieLab.fromArgb(argb)
        var best = all[0]
        var bestD = Double.MAX_VALUE
        for (c in all) {
            val d = DeltaE.ciede2000(lab, c.lab)
            if (d < bestD) { bestD = d; best = c }
        }
        return ColorMatch(best, bestD)
    }
}
