const MONTHS = ["2020-06","2020-07","2020-08","2020-09","2020-10","2020-11"];
const MONTH_LABELS = ["June 2020","July 2020","August 2020",
                      "September 2020","October 2020","November 2020"];

const LAT_MIN = 10, LAT_MAX = 45, LON_MIN = -100, LON_MAX = -15;

const W = 1040;
const H = 480;
const M = 10;

let state = {
  monthIdx: 2,
  threshold: 26.5,
  showTracks: true,
  sstByMonth: {},
  tracks: null,
  world: null,
};

const sstColor = d3.scaleSequential()
  .domain([18, 31])
  .interpolator(d3.interpolateTurbo)
  .clamp(true);

const catColor = d3.scaleOrdinal()
  .domain([-1, 0, 1, 2, 3, 4, 5])
  .range(["#bdbdbd", "#7fb3d5", "#f4d35e", "#ee964b", "#f95738", "#c1121f", "#6a040f"]);

const svg = d3.select("#map")
  .attr("viewBox", "0 0 " + W + " " + H)
  .attr("preserveAspectRatio", "xMidYMid meet");

const proj = d3.geoEquirectangular()
  .fitExtent(
    [[M, M], [W - M, H - M]],
    { type: "Polygon", coordinates: [[
      [LON_MIN, LAT_MIN], [LON_MAX, LAT_MIN],
      [LON_MAX, LAT_MAX], [LON_MIN, LAT_MAX],
      [LON_MIN, LAT_MIN],
    ]] }
  );
const pathGen = d3.geoPath(proj);

const gSst = svg.append("g");
const gLand = svg.append("g");
const gTracks = svg.append("g");
const tooltip = d3.select("#tooltip");


async function loadMonth(mk) {
  if (state.sstByMonth[mk]) return state.sstByMonth[mk];
  const d = await d3.json("data/sst_" + mk.replace("-", "_") + ".json");
  state.sstByMonth[mk] = d;
  return d;
}

async function loadAll() {
  state.world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json");
  state.tracks = await d3.json("data/tracks_2020.json");
  await loadMonth(MONTHS[state.monthIdx]);
}


function drawSst(data) {
  const lat0 = data.lat_min;
  const lon0 = data.lon_min;
  const r = data.res;
  const grid = data.sst;
  const nLat = grid.length;
  const nLon = grid[0].length;

  const p0 = proj([lon0, lat0]);
  const p1 = proj([lon0 + r, lat0 + r]);
  const cw = Math.abs(p1[0] - p0[0]) + 0.5; 
  const ch = Math.abs(p1[1] - p0[1]) + 0.5;

  const cells = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const v = grid[i][j];
      if (v === null) continue;
      cells.push({ lat: lat0 + i * r, lon: lon0 + j * r, v: v });
    }
  }

  const sel = gSst.selectAll("rect").data(cells, d => d.lat + "," + d.lon);
  sel.exit().remove();
  sel.enter().append("rect")
    .attr("width", cw)
    .attr("height", ch)
    .merge(sel)
    .attr("x", d => proj([d.lon, d.lat])[0])
    .attr("y", d => proj([d.lon, d.lat + r])[1])
    .attr("fill", d => sstColor(d.v))
    .attr("opacity", d => d.v >= state.threshold ? 1.0 : 0.5);
    // .attr("fill", "blue");
}


function drawLand() {
  const land = topojson.feature(state.world, state.world.objects.land);
  gLand.selectAll("path").data([land]).join("path")
    .attr("class", "land").attr("d", pathGen);
}


function drawTracks() {
  gTracks.selectAll("*").remove();
  if (!state.showTracks) return;

  const mk = MONTHS[state.monthIdx];
  const inMonth = state.tracks.filter(s => s.points.some(p => p.t.startsWith(mk)));

  const lineGen = d3.line()
    .x(d => proj([d.lon, d.lat])[0])
    .y(d => proj([d.lon, d.lat])[1])
    .curve(d3.curveCatmullRom);

  const g = gTracks.selectAll("g.storm").data(inMonth, d => d.id)
    .join("g").attr("class", "storm");

  g.append("path")
    .attr("class", "track")
    .attr("d", d => lineGen(d.points.filter(p => p.t.startsWith(mk))))
    .attr("stroke", d => catColor(d.category_max));
    // .attr("stroke", "black");

  g.selectAll("circle")
    .data(d => d.points.filter(p => p.t.startsWith(mk)).map(p => Object.assign({}, p, { storm: d.name })))
    .join("circle")
    .attr("class", "track-point")
    .attr("cx", p => proj([p.lon, p.lat])[0])
    .attr("cy", p => proj([p.lon, p.lat])[1])
    .attr("r", p => p.cat < 0 ? 1.8 : 2.5 + p.cat * 0.6)
    .attr("fill", p => catColor(p.cat))
    .on("mouseover", function (e, p) {
      const d = state.sstByMonth[MONTHS[state.monthIdx]];
      const i = Math.round((p.lat - d.lat_min) / d.res);
      const j = Math.round((p.lon - d.lon_min) / d.res);
      let sst = "n/a";
      if (d.sst[i] && d.sst[i][j] != null) {
        sst = d.sst[i][j].toFixed(1) + "°C";
      }
      tooltip.style("opacity", 1).html(
        "<b>" + p.storm + "</b><br>" + p.t + "<br>" +
        "Wind: " + p.wind + " kt (Cat " + (p.cat < 0 ? "TD" : p.cat) + ")<br>" +
        "SST below: " + sst
      );
      // console.log(p.storm);
    })
    .on("mousemove", function (e) {
      const xy = d3.pointer(e, document.body);
      tooltip.style("left", (xy[0] + 12) + "px").style("top", (xy[1] + 12) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0));
}


function drawLegend() {
  const lg = d3.select("#legend").html("");
  const w = 320, h = 14;
  const sv = lg.append("svg").attr("width", w + 40).attr("height", 36);
  const grad = sv.append("defs").append("linearGradient").attr("id", "sstgrad");
  for (let t = 0; t <= 1; t += 0.1) {
    grad.append("stop")
      .attr("offset", (t * 100) + "%")
      .attr("stop-color", sstColor(18 + t * (31 - 18)));
  }
  sv.append("rect").attr("x", 20).attr("y", 4).attr("width", w).attr("height", h).attr("fill", "url(#sstgrad)");
  const s = d3.scaleLinear().domain([18, 31]).range([20, 20 + w]);
  sv.append("g").attr("transform", "translate(0," + (h + 4) + ")")
    .call(d3.axisBottom(s).ticks(6).tickFormat(d => d + "°"));
  sv.append("line")
    .attr("x1", s(state.threshold)).attr("x2", s(state.threshold))
    .attr("y1", 0).attr("y2", h + 4)
    .attr("stroke", "#111").attr("stroke-width", 2);
  lg.append("div").style("margin-top", "6px")
    .html("Monthly mean SST from GOES-16 (June&ndash;November 2020). " +
          "Black tick: highlighting water above <b>" + state.threshold + "°C</b> " +
          "(26.5°C is the commonly cited threshold for hurricane intensification). " +
          "Tracks colored by each storm's peak Saffir-Simpson category.");
}


async function render() {
  const data = await loadMonth(MONTHS[state.monthIdx]);
  drawSst(data);
  drawLand();
  drawTracks();
  drawLegend();
  document.getElementById("month-label").textContent = MONTH_LABELS[state.monthIdx];
  document.getElementById("threshold-label").textContent = state.threshold + "°C";
  // console.log("rendered", state.monthIdx);
}


window.vizState = state;
window.vizRender = render;

document.getElementById("month-slider").addEventListener("input", function (e) {
  state.monthIdx = +e.target.value;
  render();
});
document.getElementById("threshold-slider").addEventListener("input", function (e) {
  state.threshold = +e.target.value;
  render();
});
document.getElementById("show-tracks").addEventListener("change", function (e) {
  state.showTracks = e.target.checked;
  render();
});

loadAll().then(render).catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend",
    "<pre style='color:#c00;padding:16px'>Load error: " + err.message + "</pre>");
});