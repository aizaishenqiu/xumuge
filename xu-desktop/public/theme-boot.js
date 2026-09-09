(function () {
  try {
    var k = localStorage.getItem("xu-theme") || localStorage.getItem("hermes-theme");
    if (k === "mist" || k === "ink") {
      document.documentElement.setAttribute("data-theme", k);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  } catch (e) {
    /* ignore */
  }
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("link[data-font-swap]").forEach(function (el) {
      el.addEventListener("load", function () {
        el.media = "all";
      });
    });
  });
})();
