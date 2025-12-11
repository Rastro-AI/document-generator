/**
 * Create a minimal IDML template with placeholders
 * IDML is a ZIP of XML files
 */

import fs from "fs";
import path from "path";
import archiver from "archiver";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "idml-spec-sheet");

// Minimal IDML structure
const designmap = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0" StoryList="Story_u123">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Fonts src="Resources/Fonts.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:MasterSpread src="MasterSpreads/MasterSpread_udd.xml"/>
  <idPkg:Spread src="Spreads/Spread_uc7.xml"/>
  <idPkg:Story src="Stories/Story_u123.xml"/>
  <idPkg:BackingStory src="XML/BackingStory.xml"/>
</Document>`;

const mimetypeContent = "application/vnd.adobe.indesign-idml-package";

const graphicXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100"/>
  <Color Self="Color/White" Model="Process" Space="CMYK" ColorValue="0 0 0 0"/>
  <Swatch Self="Swatch/None" Name="None" ColorValue="0"/>
</idPkg:Graphic>`;

const fontsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Fonts xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <FontFamily Self="FontFamily/Helvetica" Name="Helvetica">
    <Font Self="Font/Helvetica" FontFamily="Helvetica" Name="Helvetica" PostScriptName="Helvetica"/>
  </FontFamily>
</idPkg:Fonts>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <RootParagraphStyleGroup Self="RootParagraphStyleGroup/">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="[No paragraph style]" Imported="false">
      <Properties>
        <AppliedFont type="string">Helvetica</AppliedFont>
      </Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Title" Name="Title" Imported="false">
      <Properties>
        <AppliedFont type="string">Helvetica</AppliedFont>
        <PointSize type="unit">24</PointSize>
      </Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Body" Name="Body" Imported="false">
      <Properties>
        <AppliedFont type="string">Helvetica</AppliedFont>
        <PointSize type="unit">12</PointSize>
      </Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
  <RootCharacterStyleGroup Self="RootCharacterStyleGroup/">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="[No character style]"/>
  </RootCharacterStyleGroup>
</idPkg:Styles>`;

const preferencesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Preferences xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <DocumentPreference PageWidth="612" PageHeight="792" FacingPages="false" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0"/>
</idPkg:Preferences>`;

const masterSpreadXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:MasterSpread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <MasterSpread Self="udd" Name="A-Master" NamePrefix="A" BaseName="Master" ItemTransform="1 0 0 1 0 0">
    <Page Self="udd_page1" Name="A" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 792 612"/>
  </MasterSpread>
</idPkg:MasterSpread>`;

// Story with placeholder text - using {{FIELD_NAME}} syntax
const storyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Story Self="u123" AppliedTOCStyle="n" UserText="true" IsEndnoteStory="false" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Title">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>{{PRODUCT_NAME}}</Content>
      </CharacterStyleRange>
      <Br/>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>{{PRODUCT_DESCRIPTION}}</Content>
      </CharacterStyleRange>
      <Br/>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Voltage: {{VOLTAGE}} | Wattage: {{WATTAGE}} | Lumens: {{LUMENS}}</Content>
      </CharacterStyleRange>
      <Br/>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>CRI: {{CRI}} | Beam Angle: {{BEAM_ANGLE}} | Dimmable: {{DIMMABLE}}</Content>
      </CharacterStyleRange>
      <Br/>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Color Temperature: {{COLOR_TEMPERATURE}}</Content>
      </CharacterStyleRange>
      <Br/>
    </ParagraphStyleRange>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Lifetime: {{LIFETIME}} | Warranty: {{WARRANTY}}</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;

// Spread with a text frame referencing the story
const spreadXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Spread Self="uc7" PageCount="1" FlattenerOverride="Default" ShowMasterItems="true" ItemTransform="1 0 0 1 0 0" AllowPageShuffle="true">
    <Page Self="uc7_page1" Name="1" AppliedMaster="udd" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 792 612" OverrideList=""/>
    <TextFrame Self="uc7_tf1" ParentStory="u123" ItemTransform="1 0 0 1 36 36" ContentType="TextType">
      <Properties>
        <PathGeometry>
          <GeometryPathType PathOpen="false">
            <PathPointArray>
              <PathPointType Anchor="0 0" LeftDirection="0 0" RightDirection="0 0"/>
              <PathPointType Anchor="540 0" LeftDirection="540 0" RightDirection="540 0"/>
              <PathPointType Anchor="540 720" LeftDirection="540 720" RightDirection="540 720"/>
              <PathPointType Anchor="0 720" LeftDirection="0 720" RightDirection="0 720"/>
            </PathPointArray>
          </GeometryPathType>
        </PathGeometry>
      </Properties>
      <TextFramePreference TextColumnCount="1"/>
    </TextFrame>
  </Spread>
</idPkg:Spread>`;

const backingStoryXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:BackingStory xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="18.0">
  <Story Self="BackingStory" AppliedTOCStyle="n" UserText="true" IsEndnoteStory="false">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"/>
    </ParagraphStyleRange>
  </Story>
</idPkg:BackingStory>`;

async function createIdmlTemplate() {
  // Ensure output directory exists
  if (!fs.existsSync(TEMPLATE_DIR)) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  }

  const outputPath = path.join(TEMPLATE_DIR, "template.idml");
  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.pipe(output);

  // Add mimetype first (uncompressed, as per IDML spec)
  archive.append(mimetypeContent, { name: "mimetype", store: true });

  // Add XML files
  archive.append(designmap, { name: "designmap.xml" });
  archive.append(graphicXml, { name: "Resources/Graphic.xml" });
  archive.append(fontsXml, { name: "Resources/Fonts.xml" });
  archive.append(stylesXml, { name: "Resources/Styles.xml" });
  archive.append(preferencesXml, { name: "Resources/Preferences.xml" });
  archive.append(masterSpreadXml, { name: "MasterSpreads/MasterSpread_udd.xml" });
  archive.append(spreadXml, { name: "Spreads/Spread_uc7.xml" });
  archive.append(storyXml, { name: "Stories/Story_u123.xml" });
  archive.append(backingStoryXml, { name: "XML/BackingStory.xml" });

  await archive.finalize();

  console.log(`Created IDML template at: ${outputPath}`);

  // Also create template.json
  const templateJson = {
    id: "idml-spec-sheet",
    name: "IDML Spec Sheet Template",
    format: "idml",
    version: 1,
    canvas: {
      width: 612,
      height: 792,
    },
    fonts: [],
    fields: [
      { name: "PRODUCT_NAME", type: "string", description: "Main product title", example: "PAR38 LED BULB" },
      { name: "PRODUCT_DESCRIPTION", type: "string", description: "Marketing description", example: "Save up to 85% on your electric bill..." },
      { name: "VOLTAGE", type: "string", description: "Input voltage", example: "120V" },
      { name: "WATTAGE", type: "string", description: "Power consumption", example: "13W" },
      { name: "LUMENS", type: "string", description: "Light output", example: "1,050 lm" },
      { name: "CRI", type: "string", description: "Color Rendering Index", example: "80" },
      { name: "BEAM_ANGLE", type: "string", description: "Beam spread angle", example: "40°" },
      { name: "DIMMABLE", type: "string", description: "Dimming capability", example: "Yes" },
      { name: "COLOR_TEMPERATURE", type: "string", description: "Available CCTs", example: "2700K/3000K/4000K/5000K/6000K" },
      { name: "LIFETIME", type: "string", description: "Rated lifetime hours", example: "25,000+ hrs" },
      { name: "WARRANTY", type: "string", description: "Warranty period", example: "5 Years" },
    ],
    assetSlots: [
      { name: "PRODUCT_IMAGE", kind: "photo", description: "Hero product photo" },
    ],
  };

  fs.writeFileSync(
    path.join(TEMPLATE_DIR, "template.json"),
    JSON.stringify(templateJson, null, 2)
  );
  console.log("Created template.json");
}

createIdmlTemplate().catch(console.error);
