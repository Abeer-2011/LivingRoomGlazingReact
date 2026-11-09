import { useMemo, useState } from "react";
import "./App.css";
import { GLAZING_DATA as D } from "./glazingData";

const rad = (x) => (x * Math.PI) / 180;
const degSin = (x) => Math.sin(rad(x));

async function loadEPW() {
  const url = `${import.meta.env.BASE_URL}source-data/AbuDhabi.epw`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("AbuDhabi.epw could not be loaded. Copy it to public/source-data/AbuDhabi.epw.");
  const rows = (await response.text()).trim().split(/\r?\n/).slice(8).map((row) => row.split(","));
  if (rows.length < 8000) throw new Error("The EPW file is incomplete.");
  return rows
    .map((row) => ({
      m: +row[1], d: +row[2], h: +row[3], t: +row[6],
      ghi: Math.max(+row[13], 0), dni: Math.max(+row[14], 0), dhi: Math.max(+row[15], 0),
    }))
    .filter((row) => Object.values(row).every(Number.isFinite));
}

function verticalSolar(weather, orientation) {
  const azimuth = { North: 0, East: 90, South: 180, West: 270 }[orientation];
  const date = Date.UTC(2001, weather.m - 1, weather.d);
  const day = Math.floor((date - Date.UTC(2001, 0, 0)) / 86400000);
  const B = rad((360 * (day - 81)) / 364);
  const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solarTime = weather.h - 0.5 + (4 * (54.65 - 15 * 4) + equationOfTime) / 60;
  const hourAngle = rad(15 * (solarTime - 12));
  const declination = rad(23.45 * degSin((360 * (284 + day)) / 365));
  const latitude = rad(24.43);
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north = Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const up = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const incidence = up <= 0 ? 0 : east * Math.sin(rad(azimuth)) + north * Math.cos(rad(azimuth));
  return weather.dni * Math.max(incidence, 0) + 0.5 * weather.dhi + 0.1 * weather.ghi;
}

function annual(values, weather) {
  const wallU = 0.57, ach = 0.5, rho = 1.2, cp = 1006, capacity = 165000;
  const person = 75, equipment = 10, frame = 0.15, frameU = 3, setpoint = 24, cop = 3;
  const volume = values.roomArea * values.height;
  const opaqueArea = values.width * values.height - values.windowArea;
  const glassArea = values.windowArea * (1 - frame);
  const frameArea = values.windowArea * frame;
  const infiltration = (rho * cp * ach * volume) / 3600;
  const thermalCapacity = capacity * values.roomArea;
  const solar = weather.map((row) => verticalSolar(row, values.orientation));
  const occupied = weather.map((row) => row.h - 0.5 >= 17 && row.h - 0.5 < 24);
  const internal = occupied.map((yes) => yes ? values.occupants * person + equipment * values.roomArea : 0);
  const start = Math.min(168, weather.length - 1);

  return D.map((glass) => {
    const ua = wallU * opaqueArea + glass.u * glassArea + frameU * frameArea + infiltration;
    const load = weather.map((row, i) => occupied[i]
      ? Math.max(ua * (row.t - setpoint) + glass.g * solar[i] * glassArea + internal[i], 0)
      : 0);
    const thermal = load.reduce((sum, item) => sum + item, 0) / 1000;
    const electric = thermal / cop;
    const peak = Math.max(...load) / 1000;
    const indoor = Array(weather.length);
    indoor[0] = weather[0].t;
    for (let i = 0; i < weather.length - 1; i += 1) {
      indoor[i + 1] = indoor[i] + (3600 * (ua * (weather[i].t - indoor[i]) + glass.g * solar[i] * glassArea + internal[i])) / thermalCapacity;
    }
    const occupiedTemperatures = [];
    for (let i = start; i < weather.length; i += 1) if (occupied[i]) occupiedTemperatures.push(indoor[i]);
    const mean = occupiedTemperatures.reduce((sum, item) => sum + item, 0) / occupiedTemperatures.length;
    const comfort = (100 * occupiedTemperatures.filter((item) => item >= 22 && item <= 26).length) / occupiedTemperatures.length;
    const net = values.ac * 1000 - peak * 1000;
    const time = net > 0 ? (30000 * values.roomArea * Math.max(mean - setpoint, 0)) / net / 60 : Infinity;
    return { ...glass, electric, peak, mean, comfort, time, adequate: net > 0 };
  });
}

async function currentWeather(values) {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=24.4539&longitude=54.3773&current=temperature_2m,relative_humidity_2m,shortwave_radiation,direct_normal_irradiance,diffuse_radiation,wind_speed_10m&timezone=Asia%2FDubai";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Current online weather is unavailable.");
  const current = (await response.json()).current;
  const date = new Date(`${current.time}+04:00`);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const day = Math.floor((date - start) / 86400000);
  const clock = date.getUTCHours() + 4 + date.getUTCMinutes() / 60;
  const B = rad((360 * (day - 81)) / 364);
  const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solarTime = clock + (4 * (54.3773 - 60) + equationOfTime) / 60;
  const hourAngle = rad(15 * (solarTime - 12));
  const declination = rad(23.45 * degSin((360 * (284 + day)) / 365));
  const latitude = rad(24.4539);
  const east = -Math.cos(declination) * Math.sin(hourAngle);
  const north = Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const up = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const azimuth = { North: 0, East: 90, South: 180, West: 270 }[values.orientation];
  const incidence = up <= 0 ? 0 : east * Math.sin(rad(azimuth)) + north * Math.cos(rad(azimuth));
  const verticalRadiation = Math.max(current.direct_normal_irradiance || 0, 0) * Math.max(incidence, 0)
    + 0.5 * Math.max(current.diffuse_radiation || 0, 0)
    + 0.1 * Math.max(current.shortwave_radiation || 0, 0);
  const glass = D.find((item) => item.id === values.id);
  const wallArea = values.width * values.height;
  const glassArea = values.windowArea * 0.85;
  const frameArea = values.windowArea * 0.15;
  const ua = 0.57 * (wallArea - values.windowArea) + glass.u * glassArea + 3 * frameArea
    + (1.2 * 1006 * 0.5 * (values.roomArea * values.height)) / 3600;
  const solarGain = glass.g * verticalRadiation * glassArea;
  const internal = values.occupants * 75 + 10 * values.roomArea;
  const load = Math.max(ua * (current.temperature_2m - 24) + solarGain + internal, 0) / 1000;
  const noAC = current.temperature_2m + (solarGain + internal) / Math.max(ua, Number.EPSILON);
  return { time: current.time, temp: current.temperature_2m, noAC, load, adequate: values.ac > load };
}

function validate(values) {
  const tests = [
    [values.roomArea, 20, 50, "Room area"], [values.height, 2.4, 4.5, "Room height"],
    [values.width, 2, 20, "Wall width"], [values.windowArea, 1, 35, "Window area"],
    [values.occupants, 0, 10, "Occupants"], [values.ac, 1, 15, "AC capacity"],
  ];
  for (const [number, min, max, name] of tests) {
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(values.occupants)) throw new Error("Occupants must be a whole number.");
  if (values.windowArea >= values.width * values.height) throw new Error(`Window area must be smaller than wall area (${(values.width * values.height).toFixed(2)} m²).`);
  if (values.price <= 0 || values.budget <= 0) throw new Error("Price and budget must be greater than zero.");
}

const initialForm = {
  id: "S1", roomArea: 30, height: 3, width: 6, windowArea: 9,
  orientation: "North", weatherSource: "EPW Annual Analysis",
  occupants: 3, ac: 5, price: 200, budget: 2000,
};

function NumberField({ label, name, value, onChange, min, max, step = 0.1 }) {
  return <label>{label}<input name={name} type="number" value={value} min={min} max={max} step={step} onChange={onChange} required /></label>;
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("Application ready. Enter the information and press Evaluate.");
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [weather, setWeather] = useState(null);
  const wallArea = useMemo(() => Number(form.width) * Number(form.height), [form.width, form.height]);

  const change = (event) => {
    const { name, value, type } = event.target;
    setForm((old) => ({ ...old, [name]: type === "number" ? Number(value) : value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(""); setRows([]); setWeather(null); setStatus("Calculating annual results…");
    try {
      validate(form);
      const annualRows = annual(form, await loadEPW());
      let liveWeather = null;
      if (form.weatherSource === "Online Current Weather") {
        setStatus("Loading current Abu Dhabi weather…");
        liveWeather = await currentWeather(form);
      }
      setRows(annualRows); setWeather(liveWeather); setStatus("Evaluation completed.");
    } catch (problem) {
      setStatus("Evaluation could not be completed."); setError(problem.message);
    }
  };

  const selected = rows.find((item) => item.id === form.id);
  const base = rows.find((item) => item.id === "S1")?.electric;
  const ordered = [...rows].sort((a, b) => a.electric - b.electric);
  const rank = selected ? ordered.findIndex((item) => item.id === selected.id) + 1 : 0;
  const saving = selected && base ? (100 * (base - selected.electric)) / base : 0;
  const cost = form.price * form.windowArea;
  const difference = form.budget - cost;
  let suitability = "", reason = "";
  if (selected) {
    if (!selected.adequate) { suitability = "NOT SUITABLE WITH SELECTED AC"; reason = `The ${form.ac.toFixed(1)} kW AC does not exceed the ${selected.peak.toFixed(2)} kW peak load.`; }
    else if (cost > form.budget) { suitability = "NOT SUITABLE"; reason = "The selected glazing exceeds the owner's budget."; }
    else if (rank <= Math.ceil(rows.length * 0.25)) { suitability = "HIGHLY SUITABLE"; reason = "Within budget and among the best 25% for cooling electricity."; }
    else if (rank <= Math.ceil(rows.length * 0.5)) { suitability = "SUITABLE"; reason = "Within budget and in the better half for cooling electricity."; }
    else if (saving > 0) { suitability = "ACCEPTABLE"; reason = "Within budget and saves cooling electricity versus S1."; }
    else { suitability = "NOT PREFERRED"; reason = "Within budget but does not save cooling electricity versus S1."; }
  }

  return <>
    <header><h1>Living Room Glazing Decision-Support Application</h1><p>Residential living rooms in Abu Dhabi</p></header>
    <main>
      <section className="card inputs">
        <h2>Room, Window and Owner Inputs</h2>
        <form onSubmit={submit}>
          <label>Glazing type<select name="id" value={form.id} onChange={change}>{D.map((g) => <option key={g.id} value={g.id}>{g.id} — {g.description}</option>)}</select></label>
          <NumberField label="Room area (20–50 m²)" name="roomArea" value={form.roomArea} onChange={change} min="20" max="50" />
          <NumberField label="Room height (2.4–4.5 m)" name="height" value={form.height} onChange={change} min="2.4" max="4.5" />
          <NumberField label="External wall width (2–20 m)" name="width" value={form.width} onChange={change} min="2" max="20" />
          <label>Calculated wall area (m²)<input value={wallArea.toFixed(2)} readOnly /></label>
          <NumberField label="Window area (1–35 m²; less than wall)" name="windowArea" value={form.windowArea} onChange={change} min="1" max="35" />
          <label>Window orientation<select name="orientation" value={form.orientation} onChange={change}>{["North", "East", "South", "West"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Weather source<select name="weatherSource" value={form.weatherSource} onChange={change}><option>EPW Annual Analysis</option><option>Online Current Weather</option></select></label>
          <NumberField label="Occupants (0–10)" name="occupants" value={form.occupants} onChange={change} min="0" max="10" step="1" />
          <NumberField label="AC cooling capacity (1–15 kW)" name="ac" value={form.ac} onChange={change} min="1" max="15" />
          <NumberField label="Selected glass price (AED/m²)" name="price" value={form.price} onChange={change} min="1" step="1" />
          <NumberField label="Owner budget (AED)" name="budget" value={form.budget} onChange={change} min="1" step="1" />
          <button type="submit">Evaluate and Compare Glazing</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card results">
        <h2>Decision Results</h2><div className="notice">{status}</div>
        {selected && <div className="summary-grid">
          <article className="result-block"><h3>1. Selected glazing</h3><p><b>{selected.id} — {selected.description}</b></p><p>U-value: {selected.u.toFixed(3)} W/m²K</p><p>Solar factor g: {selected.g.toFixed(3)}</p></article>
          <article className="result-block"><h3>2. Owner cost</h3><p>Cost: <b>{cost.toFixed(2)} AED</b></p><p>Budget: {form.budget.toFixed(2)} AED</p><p>{difference >= 0 ? "Within budget" : "Over budget"} by {Math.abs(difference).toFixed(2)} AED</p></article>
          <article className="result-block"><h3>3. Without AC</h3><p>Mean occupied temperature: <b>{selected.mean.toFixed(2)}°C</b></p><p>Occupied hours at 22–26°C: {selected.comfort.toFixed(1)}%</p></article>
          <article className="result-block"><h3>4. With AC at 24°C</h3><p>Electricity: <b>{selected.electric.toFixed(1)} kWh/year</b></p><p>Peak cooling load: {selected.peak.toFixed(2)} kW</p><p>Time to 24°C: {Number.isFinite(selected.time) ? `${selected.time.toFixed(0)} min (simplified)` : "Not achievable at peak load"}</p></article>
          <article className="result-block"><h3>5. Comparison with S1</h3><p>S1 is a reference, not automatically the best.</p><p>Selected rank: {rank} of {rows.length}</p><p>Saving vs S1: {saving.toFixed(1)}%</p></article>
          <article className="result-block decision"><h3>6. Final decision</h3><p><b>{suitability}</b></p><p>{reason}</p></article>
          {weather && <article className="result-block"><h3>Current online weather</h3><p>{weather.time}: {weather.temp.toFixed(1)}°C outdoors</p><p>Simplified steady-state no-AC estimate: {weather.noAC.toFixed(1)}°C</p><p>Current load at 24°C: {weather.load.toFixed(2)} kW</p><p>{form.ac.toFixed(1)} kW AC adequate now: {weather.adequate ? "Yes" : "No"}</p></article>}
        </div>}
      </section>

      <section className="card comparison"><h2>Glazing Comparison</h2><div className="table-wrap"><table><thead><tr><th>Glazing ID</th><th>Glazing type</th><th>U-value<br />(W/m²K)</th><th>Solar factor g</th><th>AC electricity<br />(kWh/year)</th><th>Peak cooling<br />(kW)</th><th>AC adequate?</th><th>Time to 24°C<br />(min)</th><th>Saving vs S1<br />(%)</th></tr></thead><tbody>
        {ordered.map((item) => <tr key={item.id} className={item.id === form.id ? "selected" : ""}><td>{item.id}</td><td>{item.description}</td><td>{item.u.toFixed(3)}</td><td>{item.g.toFixed(3)}</td><td>{item.electric.toFixed(1)}</td><td>{item.peak.toFixed(2)}</td><td>{item.adequate ? "Yes" : "No"}</td><td>{Number.isFinite(item.time) ? item.time.toFixed(0) : "Not achievable"}</td><td>{base ? ((100 * (base - item.electric)) / base).toFixed(1) : "—"}</td></tr>)}
      </tbody></table></div></section>
    </main>
    <footer>Research prototype. Results are simplified engineering estimates and should not replace detailed building-energy simulation or professional design.</footer>
  </>;
}
