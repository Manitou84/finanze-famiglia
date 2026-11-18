/* disposizione letta subito (prima di disegnare), così non c'è il lampo del layout sbagliato */
try { if ((localStorage.getItem("finanze-layout") || "vetro") === "vetro") document.documentElement.classList.add("glass"); } catch (e) { document.documentElement.classList.add("glass"); }
