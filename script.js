"use strict";

// A public state-boundary GeoJSON file used directly by the browser.
const US_STATES_GEOJSON_URL =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";

const ALL_50_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];

// Compact membership is intentionally kept here so the CSV can stay focused on facilities.
const COMPACT_MEMBERSHIP = {
  Atlantic: ["Connecticut", "New Jersey", "South Carolina"],
  Northwest: [
    "Alaska",
    "Hawaii",
    "Idaho",
    "Montana",
    "Oregon",
    "Utah",
    "Washington",
    "Wyoming",
  ],
  "Rocky Mountain": ["Colorado", "Nevada", "New Mexico"],
  "Texas Compact": ["Texas", "Vermont"],
  "All US Regions": ALL_50_STATES,
  "Federal Waste": ALL_50_STATES,
};

const BASE_STATE_STYLE = {
  color: "#6f7d87",
  weight: 1,
  opacity: 0.72,
  fillOpacity: 0.04,
  fillColor: "#ffffff",
};

const HIGHLIGHT_STATE_STYLE = {
  color: "#11624f",
  weight: 2,
  opacity: 1,
  fillOpacity: 0.42,
  fillColor: "#2d9c7f",
};

const summary = document.querySelector("#selection-summary");
const timeline = document.querySelector("#facility-timeline");
const timelineArrowButtons = document.querySelectorAll("[data-timeline-scroll]");
let stateLayer;
let facilityMarkerEntries = [];
let activeTimelinePopupFacilityId = "";
let isTimelineDragging = false;
let timelineDragStartX = 0;
let timelineDragStartScrollLeft = 0;
const facilitiesById = new Map();
const facilityStarIcon = L.divIcon({
  className: "facility-star-icon",
  html: "★",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

const map = L.map("map", {
  scrollWheelZoom: true,
  zoomControl: true,
}).setView([39.5, -98.35], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Keep Alaska, Hawaii, and the continental US comfortably visible on load.
const unitedStatesBounds = L.latLngBounds([18.5, -178], [72, -66]);
map.fitBounds(unitedStatesBounds, { padding: [18, 18] });
map.setMaxBounds(unitedStatesBounds.pad(0.22));

Promise.all([
  fetch(US_STATES_GEOJSON_URL).then(checkResponse).then((response) => response.json()),
  fetch("facilities.csv").then(checkResponse).then((response) => response.text()),
])
  .then(([stateGeoJson, csvText]) => {
    drawStateBoundaries(stateGeoJson);
    addFacilityMarkers(parseCsv(csvText));
  })
  .catch((error) => {
    console.error(error);
    summary.textContent =
      "The map data could not be loaded. Start this page from a local web server and check your connection.";
  });

function checkResponse(response) {
  if (!response.ok) {
    throw new Error(`Could not load ${response.url}: ${response.status}`);
  }

  return response;
}

function drawStateBoundaries(stateGeoJson) {
  stateLayer = L.geoJSON(stateGeoJson, {
    style: BASE_STATE_STYLE,
    interactive: false,
  }).addTo(map);
}

function addFacilityMarkers(facilities) {
  const markerGroup = L.featureGroup();

  facilities.forEach((facility, index) => {
    const latitude = Number(facility.Latitude);
    const longitude = Number(facility.Longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    facility.id = String(index);
    facilitiesById.set(facility.id, facility);

    const marker = L.marker([latitude, longitude], {
      icon: facilityStarIcon,
    })
      .on("click", () => {
        selectFacilityFromMap(marker, facility);
      });

    marker.addTo(markerGroup);
    facilityMarkerEntries.push({ facility, marker });
  });

  markerGroup.addTo(map);
  buildFacilityTimeline(facilities);
}

function selectFacilityFromMap(marker, facility) {
  showFacilityCoverage(facility);
  openFacilityPopup(marker, facility);
  closeTimelinePopup();
  setActiveTimelineMarker(facility.id, { scrollIntoView: true });
}

function selectFacilityFromTimeline(facility) {
  const markerEntry = facilityMarkerEntries.find((entry) => entry.facility.id === facility.id);

  if (!markerEntry) {
    return;
  }

  showFacilityCoverage(facility);
  openFacilityPopup(markerEntry.marker, facility);
  setActiveTimelineMarker(facility.id, { scrollIntoView: false });
}

function openFacilityPopup(marker, facility) {
  const nearbyFacilities = findNearbyFacilities(marker);

  L.popup({ maxWidth: 360 })
    .setLatLng(marker.getLatLng())
    .setContent(buildPopupContent(nearbyFacilities, facility.id))
    .openOn(map);
}

function buildPopupContent(facilities, activeFacilityId) {
  if (facilities.length === 1) {
    return buildFacilityDetails(facilities[0], false, activeFacilityId);
  }

  const facilityCards = facilities
    .map((facility) => buildFacilityDetails(facility, true, activeFacilityId))
    .join("");

  return `
    <div class="popup-group">
      <h3 class="popup-title">Nearby facilities</h3>
      ${facilityCards}
    </div>
  `;
}

function buildFacilityDetails(facility, showAction, activeFacilityId) {
  const activeClass = facility.id === activeFacilityId ? " is-active" : "";
  const action = showAction
    ? `<button class="popup-facility-action${activeClass}" type="button" data-facility-id="${escapeHtml(
        facility.id,
      )}">Highlight</button>`
    : "";
  const notes = getRealNotes(facility.Notes);
  const notesMarkup = notes
    ? `
        <dt>Notes</dt>
        <dd>${escapeHtml(notes)}</dd>
      `
    : "";

  return `
    <article class="popup-facility${activeClass}">
      <div class="popup-facility-heading">
        <h4 class="popup-facility-name">${escapeHtml(facility.Name)}</h4>
        ${action}
      </div>
      <dl class="popup-list">
        <dt>LLW Classes</dt>
        <dd>${escapeHtml(facility["LLW Classes"] || "Not listed")}</dd>
        <dt>Public or Private</dt>
        <dd>${escapeHtml(facility["Public or Private"] || "Not listed")}</dd>
        <dt>Compacts</dt>
        <dd>${escapeHtml(facility.Compacts || "Not listed")}</dd>
        ${notesMarkup}
      </dl>
    </article>
  `;
}

function showFacilityCoverage(facility) {
  resetStateHighlight();

  const coverage = resolveCoverage(facility.Compacts);

  if (coverage.states.size > 0) {
    stateLayer.eachLayer((layer) => {
      const stateName = getStateName(layer.feature);

      if (coverage.states.has(stateName)) {
        layer.setStyle(HIGHLIGHT_STATE_STYLE);
      }
    });
  }

  summary.textContent = facility.Name;
}

function resetStateHighlight() {
  if (stateLayer) {
    stateLayer.setStyle(BASE_STATE_STYLE);
  }
}

function resolveCoverage(compactsCell) {
  const rawCompacts = splitCompactCell(compactsCell);
  const states = new Set();
  let label = "";
  let hasDoeControlledOnly = false;
  let hasFederalWaste = false;

  rawCompacts.forEach((compact) => {
    const normalized = normalizeCompactName(compact);

    if (normalized === "None") {
      hasDoeControlledOnly = true;
      return;
    }

    if (normalized === "Federal Waste") {
      hasFederalWaste = true;
    }

    (COMPACT_MEMBERSHIP[normalized] || []).forEach((state) => states.add(state));
  });

  if (hasFederalWaste) {
    label = "Federal waste only";
  } else if (hasDoeControlledOnly && states.size === 0) {
    label = "DOE-controlled waste only";
  } else {
    label = rawCompacts.join(", ");
  }

  return { states, label };
}

function splitCompactCell(compactsCell) {
  return String(compactsCell || "")
    .split(",")
    .map((compact) => compact.trim())
    .filter(Boolean);
}

function normalizeCompactName(compact) {
  if (compact.startsWith("All US Regions")) {
    return "All US Regions";
  }

  if (compact.startsWith("None")) {
    return "None";
  }

  return compact;
}

function getStateName(feature) {
  const properties = feature && feature.properties ? feature.properties : {};
  return properties.name || properties.NAME || properties.State || properties.STATE || "";
}

function getRealNotes(notes) {
  const trimmedNotes = String(notes || "").trim();

  if (!trimmedNotes || trimmedNotes.toLowerCase() === "none provided") {
    return "";
  }

  return trimmedNotes;
}

function findNearbyFacilities(clickedMarker) {
  const clickedPoint = map.latLngToLayerPoint(clickedMarker.getLatLng());
  const nearbyPixelRadius = 18;

  return facilityMarkerEntries
    .filter((entry) => {
      const entryPoint = map.latLngToLayerPoint(entry.marker.getLatLng());
      return clickedPoint.distanceTo(entryPoint) <= nearbyPixelRadius;
    })
    .map((entry) => entry.facility);
}

function buildFacilityTimeline(facilities) {
  if (!timeline) {
    return;
  }

  const timelineFacilities = facilities
    .map((facility) => ({ facility, openingYear: getOpeningYear(facility) }))
    .filter((entry) => Number.isFinite(entry.openingYear))
    .sort((first, second) => first.openingYear - second.openingYear);

  timeline.innerHTML = `
    <div class="timeline-track" role="list">
      ${timelineFacilities.map(({ facility, openingYear }) => buildTimelineItem(facility, openingYear)).join("")}
    </div>
  `;
}

function buildTimelineItem(facility, openingYear) {
  return `
    <div class="timeline-item" role="listitem" data-facility-id="${escapeHtml(facility.id)}">
      <button class="timeline-marker" type="button" data-facility-id="${escapeHtml(
        facility.id,
      )}" aria-expanded="false">
        <span class="timeline-year">${escapeHtml(openingYear)}</span>
        <span class="timeline-star" aria-hidden="true">★</span>
        <span class="timeline-name">${escapeHtml(facility.Name)}</span>
      </button>
      <article class="timeline-popup" hidden>
        ${buildTimelinePopupContent(facility)}
      </article>
    </div>
  `;
}

function buildTimelinePopupContent(facility) {
  const closureYear = String(facility["Planned Closure Year"] || "").trim();
  const timelineNotes = getRealNotes(facility["Timeline Notes"]);
  const closureMarkup = closureYear
    ? `
        <dt>Planned Closure Year</dt>
        <dd>${escapeHtml(closureYear)}</dd>
      `
    : "";
  const notesMarkup = timelineNotes
    ? `
        <dt>Timeline Notes</dt>
        <dd>${escapeHtml(timelineNotes)}</dd>
      `
    : "";

  return `
    <h3>${escapeHtml(facility.Name)}</h3>
    <dl>
      <dt>Began Operation</dt>
      <dd>${escapeHtml(facility["Began Operation"] || "Not listed")}</dd>
      ${closureMarkup}
      ${notesMarkup}
    </dl>
  `;
}

function getOpeningYear(facility) {
  const match = String(facility["Began Operation"] || "").match(/\d{4}/);
  return match ? Number(match[0]) : NaN;
}

function setActiveTimelineMarker(facilityId, options = {}) {
  if (!timeline) {
    return;
  }

  timeline.querySelectorAll(".timeline-item, .timeline-marker").forEach((element) => {
    element.classList.toggle("is-active", element.dataset.facilityId === facilityId);
  });

  if (options.scrollIntoView) {
    const activeItem = timeline.querySelector(`.timeline-item[data-facility-id="${cssEscape(facilityId)}"]`);

    if (activeItem) {
      activeItem.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }
}

function toggleTimelinePopup(facilityId) {
  if (activeTimelinePopupFacilityId === facilityId) {
    closeTimelinePopup();
    return;
  }

  closeTimelinePopup();
  activeTimelinePopupFacilityId = facilityId;

  const item = timeline.querySelector(`.timeline-item[data-facility-id="${cssEscape(facilityId)}"]`);
  const popup = item && item.querySelector(".timeline-popup");
  const marker = item && item.querySelector(".timeline-marker");

  if (popup && marker) {
    popup.hidden = false;
    marker.setAttribute("aria-expanded", "true");
  }
}

function closeTimelinePopup() {
  if (!timeline) {
    return;
  }

  activeTimelinePopupFacilityId = "";
  timeline.querySelectorAll(".timeline-popup").forEach((popup) => {
    popup.hidden = true;
  });
  timeline.querySelectorAll(".timeline-marker").forEach((marker) => {
    marker.setAttribute("aria-expanded", "false");
  });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".popup-facility-action");

  if (!button) {
    return;
  }

  const facility = facilitiesById.get(button.dataset.facilityId);

  if (facility) {
    showFacilityCoverage(facility);
    closeTimelinePopup();
    setActiveTimelineMarker(facility.id, { scrollIntoView: true });

    document.querySelectorAll(".popup-facility, .popup-facility-action").forEach((element) => {
      element.classList.remove("is-active");
    });
    button.classList.add("is-active");
    button.closest(".popup-facility").classList.add("is-active");
  }
});

document.addEventListener("click", (event) => {
  const timelineMarker = event.target.closest(".timeline-marker");

  if (timelineMarker) {
    event.stopPropagation();
    const facility = facilitiesById.get(timelineMarker.dataset.facilityId);

    if (facility) {
      selectFacilityFromTimeline(facility);
      toggleTimelinePopup(facility.id);
    }

    return;
  }

  if (!event.target.closest(".timeline-popup")) {
    closeTimelinePopup();
  }
});

timelineArrowButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!timeline) {
      return;
    }

    const direction = button.dataset.timelineScroll === "left" ? -1 : 1;
    timeline.scrollBy({ left: direction * timeline.clientWidth * 0.75, behavior: "smooth" });
  });
});

if (timeline) {
  timeline.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    timeline.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, { passive: false });

  timeline.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, a")) {
      return;
    }

    isTimelineDragging = true;
    timelineDragStartX = event.clientX;
    timelineDragStartScrollLeft = timeline.scrollLeft;
    timeline.classList.add("is-dragging");
    timeline.setPointerCapture(event.pointerId);
  });

  timeline.addEventListener("pointermove", (event) => {
    if (!isTimelineDragging) {
      return;
    }

    timeline.scrollLeft = timelineDragStartScrollLeft - (event.clientX - timelineDragStartX);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    timeline.addEventListener(eventName, () => {
      isTimelineDragging = false;
      timeline.classList.remove("is-dragging");
    });
  });
}

// Small CSV parser that supports quoted cells, commas inside quoted cells, and CRLF files.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());

  return rows
    .filter((dataRow) => dataRow.some((value) => value.trim() !== ""))
    .map((dataRow) => {
      const record = {};

      headers.forEach((header, index) => {
        record[header] = (dataRow[index] || "").trim();
      });

      return record;
    });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
