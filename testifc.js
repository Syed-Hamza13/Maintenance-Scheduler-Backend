import fs from "fs";
import { IfcAPI } from "web-ifc";

// 🔥 GET POSITION
function getPosition(ifcApi, modelID, element) {
  try {
    const placement = element.ObjectPlacement;
    if (!placement) return null;

    const localPlacement = ifcApi.GetLine(modelID, placement.value);
    if (!localPlacement?.RelativePlacement) return null;

    const relativePlacement = ifcApi.GetLine(
      modelID,
      localPlacement.RelativePlacement.value,
    );

    if (!relativePlacement?.Location) return null;

    const location = ifcApi.GetLine(modelID, relativePlacement.Location.value);

    return {
      x: location.Coordinates?.[0]?._value || location.Coordinates?.[0] || 0,
      y: location.Coordinates?.[1]?._value || location.Coordinates?.[1] || 0,
      z: location.Coordinates?.[2]?._value || location.Coordinates?.[2] || 0,
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

  if (n.includes("pipe") || typeName.includes("FlowSegment") || typeName.includes("FlowFitting"))
    return "plumbing";

  if (n.includes("valve") || n.includes("pump"))
    return "plumbing";

  if (n.includes("duct") || typeName.includes("FlowTerminal"))
    return "mechanical";

  if (n.includes("light") || n.includes("switch") || typeName.includes("Light"))
    return "electrical";

  if (typeName.includes("FlowController") || typeName.includes("Electric"))
    return "electrical";

  if (n.includes("chair") || n.includes("table"))
    return "furniture";

  if (
    n.includes("wall") ||
    n.includes("slab") ||
    n.includes("beam") ||
    n.includes("column")
  )
    return "structural";

  return "other";
}

// 🔥 MAINTENANCE
function getMaintenance(category, installationDate) {
  let nextInspection = "unknown";

  if (installationDate) {
    const year = new Date(installationDate).getFullYear();

    switch (category) {
      case "plumbing":
        nextInspection = `${year + 1}`;
        break;
      case "electrical":
        nextInspection = `${year + 2}`;
        break;
      case "mechanical":
        nextInspection = `${year + 1}`;
        break;
      case "structural":
        nextInspection = `${year + 5}`;
        break;
    }
  }

  return {
    inspection: category,
    nextInspection,
  };
}

// 🔥 BUILD PROPERTY MAP (ONLY ONCE - BIG FIX)
function buildPropertyMap(ifcApi, modelID) {
  const map = new Map();

  try {
    const rels = ifcApi.GetLineIDsWithType(modelID, 4186316022);

    for (let i = 0; i < rels.size(); i++) {
      const rel = ifcApi.GetLine(modelID, rels.get(i));

      if (!rel.RelatedObjects) continue;

      const propSet = ifcApi.GetLine(
        modelID,
        rel.RelatingPropertyDefinition.value,
      );

      if (!propSet?.HasProperties) continue;

      for (const obj of rel.RelatedObjects) {
        const elementID = obj.value;

        if (!map.has(elementID)) {
          map.set(elementID, {
            installationDate: null,
            manufacturer: null,
            model: null,
          });
        }

        const props = map.get(elementID);

        for (const p of propSet.HasProperties) {
          const prop = ifcApi.GetLine(modelID, p.value);

          const propName = prop.Name?.value?.toLowerCase();
          const value = prop.NominalValue?.value;

          if (!propName || !value) continue;

          if (propName.includes("installation"))
            props.installationDate = value;

          if (propName.includes("manufacturer"))
            props.manufacturer = value;

          if (propName.includes("model"))
            props.model = value;
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

  // 🔥 BUILD MAP ONCE
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

    if (!element || !element.GlobalId) continue;

    const typeName = element.constructor.name;

    // ❌ REMOVE JUNK
    if (typeName.startsWith("IfcRel")) continue;

    // 🔥 EXTRA FILTER (speed boost)
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

    const position = getPosition(ifcApi, modelID, element);
    const category = classify(name, typeName);

    // 🔥 FAST PROPERTY ACCESS
    const props = propertyMap.get(id) || {
      installationDate: null,
      manufacturer: null,
      model: null,
    };

    const maintenance = getMaintenance(category, props.installationDate);

    result.push({
      id,
      globalId,
      name,
      type: element.type,
      typeName,
      category,
      position,
      installationDate: props.installationDate,
      manufacturer: props.manufacturer,
      model: props.model,
      maintenance,
    });
  }

  ifcApi.CloseModel(modelID);

  return result;
}

// 🔥 TEST
(async () => {
  const filePath = "uploads\\ARK_NordicLCA_Housing_Terrain-Concrete_BuildingPermit_Revit.ifc";

  const data = await extractIFCData(filePath);

  console.log("🔥 TOTAL ELEMENTS:", data.length);
  console.log("🔥 SAMPLE OUTPUT:");
  console.log(JSON.stringify(data.slice(0, 20), null, 2));
})();