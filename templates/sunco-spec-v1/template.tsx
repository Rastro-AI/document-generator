// templates/sunco-spec-v1/template.tsx
// Sunco One-Page Spec Sheet Template
//
// LAYOUT:
// - Hero section: Title, Description, MODELS (left) | Product Image (right)
// - Columns: Light Distribution + Certifications (left) | Specifications (right)
//
// RULES FOR LLM EDITING:
// 1. Only use: Document, Page, View, Text, Image, StyleSheet, Font from @react-pdf/renderer
// 2. Keep the function signature: export function render(fields, assets, templateRoot)
// 3. Keep styles in StyleSheet.create() block
// 4. Do not add external imports
// 5. Make minimal changes to satisfy user requests

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import path from "path";

// ============ Types ============

type Fields = {
  PRODUCT_NAME: string;
  PRODUCT_DESCRIPTION: string;
  MODELS: string[];
  VOLTAGE: string;
  WATTAGE: string;
  CURRENT: string;
  POWER_FACTOR: string;
  LUMENS: string;
  EQUIVALENCY: string;
  FREQUENCY: string;
  CRI: string;
  BEAM_ANGLE: string;
  DIMMABLE: string;
  EFFICACY: string;
  COLOR_TEMPERATURE: string;
  OPERATING_TEMP: string;
  MOISTURE_RATING: string;
  HOUSING_MATERIAL: string;
  WEIGHT: string;
  LIFETIME: string;
  WARRANTY: string;
};

type Assets = {
  PRODUCT_IMAGE?: string;
  POLAR_GRAPH?: string;
  DISTANCE_TABLE?: string;  // The distance/lux table is an IMAGE
  CERT_FCC?: string;
  CERT_ROHS?: string;
  CERT_UL?: string;
};

// ============ Colors ============

const colors = {
  primary: "#0099CC",  // Blue - Sunco brand color
  white: "#FFFFFF",
  black: "#1a1a1a",
  darkGray: "#333333",
  gray: "#666666",
  lightGray: "#f5f5f5",
  rowGray: "#f7f7f7",
};

// ============ Styles ============

const styles = StyleSheet.create({
  page: {
    width: 816,
    height: 1056,
    backgroundColor: colors.white,
    fontFamily: "Inter",
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 6,
  },
  headerBrand: {
    color: colors.white,
    fontSize: 16,
    fontWeight: 700,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 20,
    flex: 1,
  },

  // Hero section
  hero: {
    flexDirection: "row",
    marginBottom: 20,
  },
  heroLeft: {
    flex: 1,
    paddingRight: 24,
  },
  heroRight: {
    width: 280,
    alignItems: "flex-end",
  },
  productTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: colors.black,
    marginBottom: 16,
  },
  productDescription: {
    fontSize: 10,
    color: colors.gray,
    lineHeight: 1.5,
    marginBottom: 24,
  },

  // MODELS section (inside hero)
  modelsSection: {
    marginBottom: 0,
  },
  modelsGrid: {
    flexDirection: "row",
  },
  modelsColumn: {
    width: "50%",
  },
  modelItem: {
    fontSize: 9,
    color: colors.darkGray,
    marginBottom: 2,
  },

  // Product image
  productImage: {
    width: 260,
    height: 220,
    objectFit: "contain",
  },
  productImagePlaceholder: {
    width: 260,
    height: 220,
    backgroundColor: colors.lightGray,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 10,
    color: "#999",
  },

  // Columns
  columns: {
    flexDirection: "row",
    flex: 1,
  },
  leftColumn: {
    width: "44%",
    paddingRight: 24,
  },
  rightColumn: {
    width: "56%",
  },

  // Section headers
  sectionHeader: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.black,
    paddingBottom: 6,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    marginBottom: 10,
  },
  subSectionHeader: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.darkGray,
    marginTop: 12,
    marginBottom: 4,
  },

  // Light distribution
  polarSection: {
    marginBottom: 8,
  },
  polarGraph: {
    width: "100%",
    height: 180,
    objectFit: "contain",
    marginBottom: 4,
  },
  polarGraphPlaceholder: {
    width: "100%",
    height: 180,
    backgroundColor: colors.lightGray,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  distanceTable: {
    width: "100%",
    height: 100,
    objectFit: "contain",
    marginBottom: 4,
  },
  distanceTablePlaceholder: {
    width: "100%",
    height: 100,
    backgroundColor: colors.lightGray,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  polarNote: {
    fontSize: 6,
    color: colors.gray,
    marginBottom: 16,
  },

  // Certifications
  certificationsSection: {
    marginTop: 8,
  },
  certificationsList: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  certImage: {
    width: 48,
    height: 48,
    objectFit: "contain",
  },
  certBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.darkGray,
    alignItems: "center",
    justifyContent: "center",
  },
  certBadgeText: {
    fontSize: 7,
    fontWeight: 700,
    color: colors.darkGray,
  },

  // Spec rows
  specSection: {
    marginBottom: 0,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  specRowGray: {
    backgroundColor: colors.rowGray,
  },
  specRowWhite: {
    backgroundColor: colors.white,
  },
  specLabel: {
    fontSize: 10,
    color: colors.gray,
    flex: 1,
  },
  specValue: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.darkGray,
    textAlign: "right",
  },
});

// ============ Helper Components ============

const SectionHeader = ({ children }: { children: string }) => (
  <Text style={styles.sectionHeader}>{children}</Text>
);

const SubSectionHeader = ({ children }: { children: string }) => (
  <Text style={styles.subSectionHeader}>{children}</Text>
);

const SpecRow = ({ label, value, index }: { label: string; value: string; index: number }) => (
  <View style={[styles.specRow, index % 2 === 0 ? styles.specRowGray : styles.specRowWhite]}>
    <Text style={styles.specLabel}>{label}</Text>
    <Text style={styles.specValue}>{value}</Text>
  </View>
);

const CertBadge = ({ label, imageSrc }: { label: string; imageSrc?: string }) => {
  if (imageSrc) {
    return <Image src={imageSrc} style={styles.certImage} />;
  }
  return (
    <View style={styles.certBadge}>
      <Text style={styles.certBadgeText}>{label}</Text>
    </View>
  );
};

// ============ Main Render Function ============

export function render(
  fields: Fields,
  assets: Assets,
  templateRoot: string
): React.ReactElement {
  // Register fonts
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(templateRoot, "fonts", "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(templateRoot, "fonts", "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });

  const modelsLeft = fields.MODELS.slice(0, 3);
  const modelsRight = fields.MODELS.slice(3);

  return (
    <Document>
      <Page size={{ width: 816, height: 1056 }} style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerBrand}>Sunco</Text>
        </View>

        <View style={styles.content}>
          {/* Hero: Title, Description, MODELS on left | Product Image on right */}
          <View style={styles.hero}>
            <View style={styles.heroLeft}>
              <Text style={styles.productTitle}>{fields.PRODUCT_NAME}</Text>
              <Text style={styles.productDescription}>{fields.PRODUCT_DESCRIPTION}</Text>

              {/* MODELS is in the hero section */}
              <View style={styles.modelsSection}>
                <SectionHeader>MODELS</SectionHeader>
                <View style={styles.modelsGrid}>
                  <View style={styles.modelsColumn}>
                    {modelsLeft.map((m, i) => <Text key={i} style={styles.modelItem}>{m}</Text>)}
                  </View>
                  <View style={styles.modelsColumn}>
                    {modelsRight.map((m, i) => <Text key={i} style={styles.modelItem}>{m}</Text>)}
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.heroRight}>
              {assets.PRODUCT_IMAGE ? (
                <Image src={assets.PRODUCT_IMAGE} style={styles.productImage} />
              ) : (
                <View style={styles.productImagePlaceholder}>
                  <Text style={styles.placeholderText}>[Product Image]</Text>
                </View>
              )}
            </View>
          </View>

          {/* Columns: Light Distribution + Certs | Specifications */}
          <View style={styles.columns}>
            <View style={styles.leftColumn}>
              {/* Light Distribution - images passed as assets */}
              <View style={styles.polarSection}>
                <SectionHeader>LIGHT DISTRIBUTION ANGLE</SectionHeader>

                {assets.POLAR_GRAPH ? (
                  <Image src={assets.POLAR_GRAPH} style={styles.polarGraph} />
                ) : (
                  <View style={styles.polarGraphPlaceholder}>
                    <Text style={styles.placeholderText}>[Polar Graph]</Text>
                  </View>
                )}

                {assets.DISTANCE_TABLE ? (
                  <Image src={assets.DISTANCE_TABLE} style={styles.distanceTable} />
                ) : (
                  <View style={styles.distanceTablePlaceholder}>
                    <Text style={styles.placeholderText}>[Distance Table]</Text>
                  </View>
                )}

                <Text style={styles.polarNote}>
                  NOTE: The curves indicate the illuminated area and the average illumination at different distances.
                </Text>
              </View>

              {/* Certifications */}
              <View style={styles.certificationsSection}>
                <SectionHeader>CERTIFICATIONS</SectionHeader>
                <View style={styles.certificationsList}>
                  <CertBadge label="FCC" imageSrc={assets.CERT_FCC} />
                  <CertBadge label="RoHS" imageSrc={assets.CERT_ROHS} />
                  <CertBadge label="UL" imageSrc={assets.CERT_UL} />
                </View>
              </View>
            </View>

            {/* Right column: Specifications */}
            <View style={styles.rightColumn}>
              <SectionHeader>SPECIFICATIONS</SectionHeader>

              <View style={styles.specSection}>
                <SpecRow label="Voltage" value={fields.VOLTAGE} index={0} />
                <SpecRow label="Wattage" value={fields.WATTAGE} index={1} />
                <SpecRow label="Current" value={fields.CURRENT} index={2} />
                <SpecRow label="Power Factor" value={fields.POWER_FACTOR} index={3} />
              </View>

              <SubSectionHeader>LIGHTING PERFORMANCE</SubSectionHeader>
              <View style={styles.specSection}>
                <SpecRow label="Lumens" value={fields.LUMENS} index={0} />
                <SpecRow label="Equivalency" value={fields.EQUIVALENCY} index={1} />
                <SpecRow label="Frequency" value={fields.FREQUENCY} index={2} />
                <SpecRow label="Color Rendering Index" value={fields.CRI} index={3} />
                <SpecRow label="Beam Angle" value={fields.BEAM_ANGLE} index={4} />
                <SpecRow label="Dimmable" value={fields.DIMMABLE} index={5} />
                <SpecRow label="Efficacy" value={fields.EFFICACY} index={6} />
                <SpecRow label="Color Temperature" value={fields.COLOR_TEMPERATURE} index={7} />
              </View>

              <SubSectionHeader>ENVIRONMENT</SubSectionHeader>
              <View style={styles.specSection}>
                <SpecRow label="Operating Temperature" value={fields.OPERATING_TEMP} index={0} />
                <SpecRow label="Moisture Rating" value={fields.MOISTURE_RATING} index={1} />
              </View>

              <SubSectionHeader>CONSTRUCTION</SubSectionHeader>
              <View style={styles.specSection}>
                <SpecRow label="Housing Material" value={fields.HOUSING_MATERIAL} index={0} />
                <SpecRow label="Weight" value={fields.WEIGHT} index={1} />
              </View>

              <SubSectionHeader>LIFETIME</SubSectionHeader>
              <View style={styles.specSection}>
                <SpecRow label="Average Lifetime" value={fields.LIFETIME} index={0} />
                <SpecRow label="Warranty" value={fields.WARRANTY} index={1} />
              </View>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
