(function () {
  "use strict";
  var T = globalThis.TCGAM;
  var form = document.getElementById("settings");

  function render(settings) {
    form.innerHTML = "";
    T.SCHEMA.forEach(function (f) {
      var row = document.createElement("label");
      if (f.type === "bool") {
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!settings[f.key];
        cb.addEventListener("change", function () {
          settings[f.key] = cb.checked; T.save(settings);
        });
        row.appendChild(cb);
        row.appendChild(document.createTextNode(f.label));
      } else if (f.type === "range") {
        var text = document.createElement("span");
        text.textContent = f.label + ": " + settings[f.key] + (f.unit || "");
        var range = document.createElement("input");
        range.type = "range"; range.min = f.min; range.max = f.max; range.step = f.step; range.value = settings[f.key];
        range.addEventListener("input", function () { text.textContent = f.label + ": " + range.value + (f.unit || ""); });
        range.addEventListener("change", function () { settings[f.key] = Number(range.value); T.save(settings); });
        row.appendChild(text);
        row.appendChild(range);
      }
      form.appendChild(row);
    });
  }

  T.load().then(render);
})();
