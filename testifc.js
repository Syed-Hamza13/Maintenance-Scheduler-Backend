import fs from "fs";
import { IfcAPI } from "web-ifc";

// 🔥 SAFE VALUE EXTRACTOR
function val(v) {
  return v?._value ?? v?.value ?? v ?? null;
}

// 🔥 GET POSITION
function getPosition(ifcApi, modelID, element) {
  try {
    const placement = element.ObjectPlacement;
    if (!placement) return null;

    const localPlacement = ifcApi.GetLine(modelID, placement.value);
    const relativePlacement = ifcApi.GetLine(
      modelID,
      localPlacement?.RelativePlacement?.value,
    );

    const location = ifcApi.GetLine(
      modelID,
      relativePlacement?.Location?.value,
    );

    return {
      x: val(location?.Coordinates?.[0]),
      y: val(location?.Coordinates?.[1]),
      z: val(location?.Coordinates?.[2]),
    };
  } catch {
    return null;
  }
}

// 🔥 CLASSIFIER
function classify(name, typeName) {
  const n = (name || "").toLowerCase();

  if (n.includes("toilet") || n.includes("sink") || n.includes("shower"))
    return "plumbing";

  if (n.includes("pipe") || typeName.includes("FlowSegment"))
    return "plumbing";

  if (n.includes("valve") || n.includes("pump"))
    return "plumbing";

  if (n.includes("duct") || typeName.includes("FlowTerminal"))
    return "mechanical";

  if (n.includes("light") || typeName.includes("Light"))
    return "electrical";

  if (typeName.includes("Electric")) return "electrical";

  if (
    n.includes("wall") ||
    n.includes("slab") ||
    n.includes("beam") ||
    n.includes("column")
  )
    return "structural";

  return "other";
}

// 🔥 SMART ENRICHMENT (MAIN MAGIC)
function enrichData(obj) {
  const currentYear = new Date().getFullYear();

  // ✅ Default installation date
  if (!obj.installationDate) {
    obj.installationDate = `${currentYear - 3}-01-01`; // assume 3 years old
  }

  // ✅ Manufacturer inference
  if (!obj.manufacturer) {
    switch (obj.category) {
      case "electrical":
        obj.manufacturer = "Generic Electrical Co.";
        break;
      case "plumbing":
        obj.manufacturer = "Standard Plumbing Ltd.";
        break;
      case "mechanical":
        obj.manufacturer = "HVAC Systems Ltd.";
        break;
      case "structural":
        obj.manufacturer = "Civil Construction";
        break;
      default:
        obj.manufacturer = "Unknown Supplier";
    }
  }

  // ✅ Model fallback
  if (!obj.model) {
    obj.model = obj.objectType || obj.typeName;
  }

  return obj;
}

// 🔥 MAINTENANCE (REAL DATE CALCULATION)
function getMaintenance(category, installationDate) {
  let nextInspection = "unknown";

  if (installationDate) {
    const date = new Date(installationDate);

    switch (category) {
      case "plumbing":
        date.setMonth(date.getMonth() + 12);
        break;
      case "electrical":
        date.setMonth(date.getMonth() + 24);
        break;
      case "mechanical":
        date.setMonth(date.getMonth() + 12);
        break;
      case "structural":
        date.setFullYear(date.getFullYear() + 5);
        break;
    }

    nextInspection = date.toISOString().split("T")[0];
  }

  return { inspection: category, nextInspection };
}

// 🔥 BUILD PROPERTY MAP
function buildPropertyMap(ifcApi, modelID) {
  const map = new Map();

  try {
    const rels = ifcApi.GetLineIDsWithType(modelID, 4186316022);

    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));

      const propSet = ifcApi.GetLine(
        modelID,
        rel.RelatingPropertyDefinition.value,
      );

      if (!propSet?.HasProperties) continue;

      for (const obj of rel.RelatedObjects || []) {
        const id = obj.value;

        if (!map.has(id)) {
          map.set(id, {
            installationDate: null,
            manufacturer: null,
            model: null,
            properties: {},
          });
        }

        const data = map.get(id);

        for (const p of propSet.HasProperties) {
          const prop = ifcApi.GetLine(modelID, p.value);

          const name = prop.Name?.value;
          const value = val(prop.NominalValue);

          if (!name) continue;

          data.properties[name] = value;

          const lname = name.toLowerCase();

          if (lname.includes("installation"))
            data.installationDate = value;

          if (lname.includes("manufacturer"))
            data.manufacturer = value;

          if (lname.includes("model"))
            data.model = value;
        }
      }
    }
  } catch {}

  return map;
}

// 🔥 MAIN ENGINE
async function extractIFCData(filePath) {
  const ifcApi = new IfcAPI();
  await ifcApi.Init();

  const buffer = fs.readFileSync(filePath);
  const modelID = ifcApi.OpenModel(buffer);

  const result = [];
  const seen = new Set();

  const propertyMap = buildPropertyMap(ifcApi, modelID);
  const allLines = ifcApi.GetAllLines(modelID);

  for (let i = 0; i < allLines.size(); i++) {
    const id = allLines.get(i);

    let element;
    try {
      element = ifcApi.GetLine(modelID, id);
    } catch {
      continue;
    }

    if (!element?.GlobalId) continue;

    const typeName = element.constructor.name;

    if (typeName.startsWith("IfcRel")) continue;

    if (
      !typeName.includes("Wall") &&
      !typeName.includes("Flow") &&
      !typeName.includes("Light") &&
      !typeName.includes("Door") &&
      !typeName.includes("Window") &&
      !typeName.includes("Column") &&
      !typeName.includes("Beam")
    ) continue;

    const globalId = element.GlobalId.value;
    if (seen.has(globalId)) continue;
    seen.add(globalId);

    const name = element.Name?.value || "No Name";

    const category = classify(name, typeName);
    const props = propertyMap.get(id) || {};

    let obj = {
      id,
      globalId,
      name,
      typeName,

      tag: element.Tag?.value || null,
      description: element.Description?.value || null,
      objectType: element.ObjectType?.value || null,
      predefinedType: element.PredefinedType || null,

      category,
      position: getPosition(ifcApi, modelID, element),

      installationDate: props.installationDate || null,
      manufacturer: props.manufacturer || null,
      model: props.model || null,

      properties: props.properties || {},
    };

    // 🔥 APPLY ENRICHMENT
    obj = enrichData(obj);

    // 🔥 FINAL MAINTENANCE
    obj.maintenance = getMaintenance(obj.category, obj.installationDate);

    result.push(obj);
  }

  ifcApi.CloseModel(modelID);
  return result;
}

// 🔥 TEST
(async () => {
  const filePath =
    "uploads\\ARK_NordicLCA_Housing_Terrain-Concrete_BuildingPermit_Revit.ifc";

  const data = await extractIFCData(filePath);

  console.log("🔥 TOTAL ELEMENTS:", data.length);
  console.log(JSON.stringify(data.slice(0, 10), null, 2));
})();

export { extractIFCData };