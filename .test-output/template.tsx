import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    width: 612,
    height: 792,
    paddingTop: 0,
    paddingBottom: 40,
    paddingLeft: 0,
    paddingRight: 0,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  headerBar: {
    height: 100,
    backgroundColor: "#008fbf",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingLeft: 40,
    paddingRight: 40,
  },
  headerLogoWrapper: {
    height: 40,
    justifyContent: "center",
  },
  headerLogoImage: {
    height: 32,
    width: 120,
  },
  headerLogoPlaceholder: {
    height: 32,
    width: 120,
    backgroundColor: "#e0e0e0",
  },

  content: {
    marginTop: 0,
    flexDirection: "row",
  },
  bodyWrapper: {
    paddingTop: 40,
    paddingLeft: 40,
    paddingRight: 40,
  },
  leftColumn: {
    flex: 3,
    paddingRight: 24,
  },
  rightColumn: {
    flex: 2,
    paddingLeft: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#212121",
  },
  description: {
    marginTop: 16,
    fontSize: 10,
    lineHeight: 1.4,
    color: "#424242",
  },
  sectionHeading: {
    marginTop: 24,
    fontSize: 11,
    fontWeight: "bold",
    color: "#000000",
  },
  modelsRow: {
    marginTop: 10,
    flexDirection: "row",
  },
  modelsColumn: {
    flex: 1,
  },
  modelsText: {
    fontSize: 9,
    color: "#000000",
    lineHeight: 1.4,
  },
  sectionDivider: {
    marginTop: 6,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#bdbdbd",
    borderBottomStyle: "solid",
  },
  lightDistributionImageWrapper: {
    marginTop: 10,
    alignItems: "center",
  },
  lightDistributionImage: {
    width: 260,
    height: 410,
    objectFit: "contain",
  },
  lightDistributionPlaceholder: {
    width: 260,
    height: 410,
    backgroundColor: "#f0f0f0",
  },
  noteText: {
    marginTop: 6,
    fontSize: 7,
    color: "#616161",
  },
  certificationsSection: {
    marginTop: 18,
  },
  certificationsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  certIcon: {
    width: 40,
    height: 40,
    marginRight: 16,
    objectFit: "contain",
  },
  certIconPlaceholder: {
    width: 40,
    height: 40,
    marginRight: 16,
    backgroundColor: "#e0e0e0",
  },
  specsContainer: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderStyle: "solid",
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
  },
  specsMainHeading: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#000000",
  },
  specsSectionHeading: {
    marginTop: 10,
    marginBottom: 4,
    fontSize: 9,
    fontWeight: "bold",
    color: "#000000",
  },
  specRow: {
    flexDirection: "row",
    fontSize: 8,
    marginBottom: 2,
  },
  specLabelCell: {
    width: 90,
    backgroundColor: "#f5f5f5",
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 4,
    paddingRight: 4,
  },
  specLabelText: {
    fontSize: 8,
    color: "#757575",
  },
  specValueCell: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 6,
    paddingRight: 4,
  },
  specValueText: {
    fontSize: 8,
    color: "#000000",
    fontWeight: "bold",
  },
});

export function render(
  fields: Record<string, string | number | string[] | null>,
  assets: Record<string, string | null>,
  templateRoot: string
): React.ReactElement {
  const get = (name: string, fallback: string = ""): string => {
    const value = fields[name];
    if (Array.isArray(value)) return value.join("\n");
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  };

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* HEADER BAR */}
        <View style={styles.headerBar}>
          <View style={styles.headerLogoWrapper}>
            {assets.LOGO ? (
              <Image src={assets.LOGO} style={styles.headerLogoImage} />
            ) : (
              <View style={styles.headerLogoPlaceholder} />
            )}
          </View>
        </View>

        {/* MAIN CONTENT */}
        <View style={styles.bodyWrapper}>
        <View style={styles.content}>
          {/* LEFT COLUMN */}
          <View style={styles.leftColumn}>
            <Text style={styles.title}>{get("TITLE", "PAR38 LED BULB")}</Text>
            <Text style={styles.description}>
              {get(
                "DESCRIPTION",
                "Save up to 85% on your electric bill with long-lasting LED bulbs. Low power usage replacement for incandescent, halogen and fluorescent light bulbs."
              )}
            </Text>

            {/* MODELS SECTION */}
            <Text style={styles.sectionHeading}>{get("MODELS_HEADING", "MODELS")}</Text>
            <View style={styles.sectionDivider} />
            <View style={styles.modelsRow}>
              <View style={styles.modelsColumn}>
                <Text style={styles.modelsText}>{get("MODELS_COLUMN_LEFT")}</Text>
              </View>
              <View style={styles.modelsColumn}>
                <Text style={styles.modelsText}>{get("MODELS_COLUMN_RIGHT")}</Text>
              </View>
            </View>

            {/* LIGHT DISTRIBUTION ANGLE */}
            <Text style={styles.sectionHeading}>{get("LIGHT_DISTRIBUTION_HEADING", "LIGHT DISTRIBUTION ANGLE")}</Text>
            <View style={styles.sectionDivider} />
            <View style={styles.lightDistributionImageWrapper}>
              {assets.LIGHT_DISTRIBUTION_CHART ? (
                <Image
                  src={assets.LIGHT_DISTRIBUTION_CHART}
                  style={styles.lightDistributionImage}
                />
              ) : (
                <View style={styles.lightDistributionPlaceholder} />
              )}
            </View>
            <Text style={styles.noteText}>{get("LIGHT_DISTRIBUTION_NOTE")}</Text>

            {/* CERTIFICATIONS */}
            <View style={styles.certificationsSection}>
              <Text style={styles.sectionHeading}>{get("CERTIFICATIONS_HEADING", "CERTIFICATIONS")}</Text>
              <View style={styles.certificationsRow}>
                {assets.CERT_FCC_ICON ? (
                  <Image src={assets.CERT_FCC_ICON} style={styles.certIcon} />
                ) : (
                  <View style={styles.certIconPlaceholder} />
                )}
                {assets.CERT_ROHS_ICON ? (
                  <Image src={assets.CERT_ROHS_ICON} style={styles.certIcon} />
                ) : (
                  <View style={styles.certIconPlaceholder} />
                )}
                {assets.CERT_UL_ICON ? (
                  <Image src={assets.CERT_UL_ICON} style={styles.certIcon} />
                ) : (
                  <View style={styles.certIconPlaceholder} />
                )}
              </View>
            </View>
          </View>

          {/* RIGHT COLUMN */}
          <View style={styles.rightColumn}>
            {assets.PRODUCT_IMAGE ? (
              <Image src={assets.PRODUCT_IMAGE} style={{ width: 170, height: 170, alignSelf: "flex-end", marginBottom: 10 }} />
            ) : (
              <View
                style={{ width: 170, height: 170, alignSelf: "flex-end", marginBottom: 10, backgroundColor: "#e0e0e0" }}
              />
            )}
            <View style={styles.specsContainer}>
              <Text style={styles.specsMainHeading}>{get("SPECIFICATIONS_HEADING", "SPECIFICATIONS")}</Text>

              {/* BASIC SPECS */}
              <View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Voltage</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("SPEC_VOLTAGE", "120V")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Wattage</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("SPEC_WATTAGE", "13W")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Current</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("SPEC_CURRENT", "0.145A")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Power Factor</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("SPEC_POWER_FACTOR", "0.7")}</Text>
                  </View>
                </View>
              </View>

              {/* LIGHTING PERFORMANCE */}
              <Text style={styles.specsSectionHeading}>{get("LIGHTING_PERFORMANCE_HEADING", "LIGHTING PERFORMANCE")}</Text>
              <View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Lumens</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_LUMENS", "1,050 lm")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Equivalency</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_EQUIVALENCY", "100W")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Frequency</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_FREQUENCY", "60 Hz")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Color Rendering Index</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_CRI", "80")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Beam Angle</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_BEAM_ANGLE", "40°")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Dimmable</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_DIMMABLE", "Yes")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Efficacy</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("PERF_EFFICACY", "81 lm/w")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Color Temperature</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>
                      {get("PERF_COLOR_TEMPERATURE", "2700K/3000K/4000K/5000K/6000K")}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ENVIRONMENT */}
              <Text style={styles.specsSectionHeading}>{get("ENVIRONMENT_HEADING", "ENVIRONMENT")}</Text>
              <View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Operating Temperature</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("ENV_OPERATING_TEMPERATURE", "-4° F - 104° F")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Moisture Rating</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("ENV_MOISTURE_RATING", "Wet")}</Text>
                  </View>
                </View>
              </View>

              {/* CONSTRUCTION */}
              <Text style={styles.specsSectionHeading}>{get("CONSTRUCTION_HEADING", "CONSTRUCTION")}</Text>
              <View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Housing Material</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("CONSTR_HOUSING_MATERIAL", "Aluminum + PC")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Weight</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("CONSTR_WEIGHT", "0.22 lbs")}</Text>
                  </View>
                </View>
              </View>

              {/* LIFETIME */}
              <Text style={styles.specsSectionHeading}>{get("LIFETIME_HEADING", "LIFETIME")}</Text>
              <View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Average Lifetime</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("LIFE_AVERAGE_LIFETIME", "25,000+ hrs")}</Text>
                  </View>
                </View>
                <View style={styles.specRow}>
                  <View style={styles.specLabelCell}>
                    <Text style={styles.specLabelText}>Warranty</Text>
                  </View>
                  <View style={styles.specValueCell}>
                    <Text style={styles.specValueText}>{get("LIFE_WARRANTY", "5 Years")}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
        </View>
      </Page>
    </Document>
  );
}
