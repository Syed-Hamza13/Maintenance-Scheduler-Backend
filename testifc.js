import fs from "fs";
import {
  IfcAPI,

  IFCWALL, IFCSLAB, IFCBEAM, IFCCOLUMN, IFCROOF, IFCFOOTING,
  IFCDOOR, IFCWINDOW,

  IFCPIPESEGMENT, IFCFLOWTERMINAL, IFCFLOWCONTROLLER,
  IFCFLOWFITTING, IFCFLOWMETER, IFCPUMP, IFCVALVE,
  IFCBOILER, IFCFAN, IFCAIRTERMINAL,
  IFCDUCTSEGMENT, IFCDUCTFITTING,

  IFCLIGHTFIXTURE, IFCSWITCHINGDEVICE,
  IFCELECTRICDISTRIBUTIONBOARD,

  IFCSANITARYTERMINAL, IFCFURNISHINGELEMENT

} from "web-ifc";


// 🔥 GET POSITION
function getPosition(ifcApi, modelID, element) {
  try {
    const placement = element.ObjectPlacement;
    if (!placement) return null;

    const localPlacement = ifcApi.GetLine(modelID, placement.value);
    const relativePlacement = ifcApi.GetLine(
      modelID,
      localPlacement.RelativePlacement.value
    );

    const location = ifcApi.GetLine(
      modelID,
      relativePlacement.Location.value
    );

    return {
      x: location.Coordinates[0],
      y: location.Coordinates[1],
      z: location.Coordinates[2]
    };
  } catch {
    return null;
  }
}


// 🔥 CATEGORY CLASSIFIER
function classify(name) {
  const n = name.toLowerCase();

  if (n.includes("toilet") || n.includes("sink") || n.includes("shower"))
    return "plumbing";

  if (n.includes("pump") || n.includes("fan") || n.includes("duct"))
    return "mechanical";

  if (n.includes("light") || n.includes("switch"))
    return "electrical";

  if (n.includes("chair") || n.includes("table"))
    return "furniture";

  if (n.includes("wall") || n.includes("slab") || n.includes("beam"))
    return "structural";

  return "other";
}


// 🔥 MAINTENANCE RULES
function getMaintenance(category) {
  if (category === "plumbing")
    return { inspection: "monthly", cleaning: "weekly" };

  if (category === "electrical")
    return { inspection: "6 months" };

  if (category === "mechanical")
    return { inspection: "3 months" };

  if (category === "furniture")
    return { inspection: "yearly" };

  if (category === "structural")
    return { inspection: "5 years" };

  return { inspection: "unknown" };
}


async function extractIFCData(filePath) {

  const ifcApi = new IfcAPI();
  await ifcApi.Init();

  const buffer = fs.readFileSync(filePath);
  const modelID = ifcApi.OpenModel(buffer);

  const types = [
    IFCWALL, IFCSLAB, IFCBEAM, IFCCOLUMN, IFCROOF, IFCFOOTING,
    IFCDOOR, IFCWINDOW,
    IFCPIPESEGMENT, IFCFLOWTERMINAL, IFCFLOWCONTROLLER,
    IFCFLOWFITTING, IFCFLOWMETER, IFCPUMP, IFCVALVE,
    IFCBOILER, IFCFAN, IFCAIRTERMINAL,
    IFCDUCTSEGMENT, IFCDUCTFITTING,
    IFCLIGHTFIXTURE, IFCSWITCHINGDEVICE,
    IFCELECTRICDISTRIBUTIONBOARD,
    IFCSANITARYTERMINAL, IFCFURNISHINGELEMENT
  ];

  const result = [];

  for (let type of types) {

    const ids = ifcApi.GetLineIDsWithType(modelID, type);

    for (let i = 0; i < ids.size(); i++) {

      const id = ids.get(i);
      const element = ifcApi.GetLine(modelID, id);

      const name = element.Name?.value || "No Name";

      const position = getPosition(ifcApi, modelID, element);
      const category = classify(name);
      const maintenance = getMaintenance(category);

      result.push({
        id,
        name,
        type: element.type,
        category,
        position,
        maintenance
      });
    }
  }

  ifcApi.CloseModel(modelID);

  return result;
}


// 🔥 TEST
(async () => {

  const filePath = "uploads\\20210219Architecture.ifc";

  const data = await extractIFCData(filePath);

  console.log("🔥 FINAL OUTPUT:");
  console.log(JSON.stringify(data.slice(0, 20), null, 2)); // limit for readability

})();