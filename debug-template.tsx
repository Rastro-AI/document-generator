import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 36,
    paddingBottom: 36,
    paddingLeft: 36,
    paddingRight: 36,
    color: "#000000",
  },
  headerWave: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 90,
    backgroundColor: "#00b050",
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  logoContainer: {
    width: 140,
    height: 40,
  },
  logoPlaceholder: {
    width: 140,
    height: 40,
    backgroundColor: "#e0e0e0",
  },
  tagline: {
    fontSize: 10,
    color: "#ffffff",
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerRightBadge: {
    borderWidth: 1,
    borderColor: "#00b050",
    borderStyle: "solid",
    borderRadius: 6,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 10,
    paddingRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRightBadgeText: {
    fontSize: 16,
    color: "#00b050",
  },
  contentWrapper: {
    marginTop: 70,
    flexDirection: "row",
  },
  leftColumn: {
    width: 360,
    paddingRight: 18,
  },
  rightColumn: {
    flex: 1,
    paddingLeft: 18,
  },
  productTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 6,
  },
  productSubtitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 9,
    lineHeight: 1.4,
    marginBottom: 10,
  },
  sectionHeadingGreen: {
    fontSize: 12,
    fontWeight: 700,
    color: "#00b050",
    marginTop: 8,
    marginBottom: 4,
  },
  modelsContainer: {
    marginTop: 4,
    marginBottom: 10,
  },
  modelsRow: {
    flexDirection: "row",
  },
  modelText: {
    fontSize: 9,
    marginRight: 20,
    marginBottom: 2,
  },
  lightDistributionSection: {
    marginTop: 10,
  },
  chartImage: {
    width: 260,
    height: 180,
  },
  smallChartImage: {
    width: 150,
    height: 140,
    marginTop: 10,
  },
  spectrumCaption: {
    fontSize: 8,
    marginTop: 4,
  },
  certificationsSection: {
    marginTop: 14,
  },
  certificationsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  certLogo: {
    width: 46,
    height: 32,
    marginRight: 8,
  },
  certLogoPlaceholder: {
    width: 46,
    height: 32,
    marginRight: 8,
    backgroundColor: "#e0e0e0",
  },
  certificationNote: {
    fontSize: 7,
    marginTop: 6,
  },
  productImageContainer: {
    marginTop: 20,
    marginBottom: 18,
    alignItems: "center",
  },
  productImage: {
    width: 200,
    height: 200,
    objectFit: "contain",
  },
  specsTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#00b050",
    marginBottom: 6,
  },
  specsSection: {
    marginBottom: 8,
  },
  specsSectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: "#00b050",
    marginTop: 3,
    marginBottom: 3,
  },
  specRow: {
    flexDirection: "row",
    fontSize: 8.5,
  },
  specLabelCell: {
    width: 120,
    backgroundColor: "#f2f2f2",
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 5,
    paddingRight: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#ffffff",
    borderBottomStyle: "solid",
  },
  specValueCell: {
    flex: 1,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 5,
    paddingRight: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
    borderBottomStyle: "solid",
  },
  specLabelText: {
    fontSize: 8,
  },
  specValueText: {
    fontSize: 8,
    fontWeight: 700,
    textAlign: "right",
  },
  footerRow: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
  },
});

export function render(
  fields: Record<string, any>,
  assets: Record<string, string | null>,
  templateRoot: string
): React.ReactElement {
  const specSections = (fields.SPECIFICATION_SECTIONS as {
    title: string;
    items: { label: string; value: string }[];
  }[]) || [];

  const models = (fields.MODELS as string[]) || [];
  const mid = Math.ceil(models.length / 2);
  const leftModels = models.slice(0, mid);
  const rightModels = models.slice(mid);

  return (
    <Document>
      <Page size={{ width: 612, height: 792 }} style={styles.page}>
        {/* Green header shape (approximation as solid band) */}
        <View style={styles.headerWave} />

        <View style={styles.headerTopRow}>
          <View>
            <View style={styles.logoContainer}>
              {assets.COMPANY_LOGO ? (
                <Image src={assets.COMPANY_LOGO} style={styles.logoContainer} />
              ) : (
                <View style={styles.logoPlaceholder} />
              )}
            </View>
          </View>
          <View>
            <Text style={styles.tagline}>
              {fields.HEADER_TAGLINE || "The Brighter Choice"}
            </Text>
          </View>
        </View>

        <View
          style={{
            position: "absolute",
            top: 28,
            right: 36,
          }}
        >
          <View style={styles.headerRightBadge}>
            <Text style={styles.headerRightBadgeText}>
              {fields.PRODUCT_BADGE || "L6"}
            </Text>
          </View>
        </View>

        <View style={styles.contentWrapper}>
          {/* Left column */}
          <View style={styles.leftColumn}>
            <Text style={styles.productSubtitle}>
              {fields.PRODUCT_CATEGORY || 'BAFFLE 5/6" LED DOWNLIGHT'}
            </Text>
            <Text style={styles.productTitle}>
              {fields.PRODUCT_TITLE || 'BAFFLE 5/6" LED DOWNLIGHT'}
            </Text>

            <Text style={styles.bodyText}>
              {fields.PRODUCT_DESCRIPTION ||
                'The damp rated and dimmable Recessed LED Baffle 5/6" Downlight with a bright 965 lumens adjusts to fit 5" or 6" cans. Easily convert the included mounting bracket with a screwdriver. Use the included TP24 connector or E26 adapter base, depending on what your existing can accepts. Uniformed, baffled grooves minimize glare. Consuming only 13W, this light is equivalent to a 75W bulb.'}
            </Text>

            <Text style={styles.sectionHeadingGreen}>
              {fields.MODELS_HEADING || "MODELS"}
            </Text>
            <View style={styles.modelsContainer}>
              <View style={styles.modelsRow}>
                <View>
                  {leftModels.map((m, i) => (
                    <Text key={i} style={styles.modelText}>
                      {m}
                    </Text>
                  ))}
                </View>
                <View>
                  {rightModels.map((m, i) => (
                    <Text key={i} style={styles.modelText}>
                      {m}
                    </Text>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.lightDistributionSection}>
              <Text style={styles.sectionHeadingGreen}>
                {fields.LIGHT_DISTRIBUTION_HEADING || "LIGHT DISTRIBUTION ANGLE"}
              </Text>
              <Text style={styles.productSubtitle}>
                {fields.SPECTRUM_HEADING || "SPECTRUM DISTRIBUTION"}
              </Text>
              <View style={{ marginTop: 6 }}>
                {assets.SPECTRUM_CHART ? (
                  <Image src={assets.SPECTRUM_CHART} style={styles.chartImage} />
                ) : (
                  <View style={[styles.chartImage, { backgroundColor: "#e0e0e0" }]} />
                )}
              </View>
              <Text style={styles.spectrumCaption}>
                {fields.SPECTRUM_CAPTION || "CIE1931 Chromaticity Diagram"}
              </Text>
              <View>
                {assets.CHROMATICITY_CHART ? (
                  <Image
                    src={assets.CHROMATICITY_CHART}
                    style={styles.smallChartImage}
                  />
                ) : (
                  <View
                    style={[
                      styles.smallChartImage,
                      { backgroundColor: "#e0e0e0" },
                    ]}
                  />
                )}
              </View>
            </View>

            <View style={styles.certificationsSection}>
              <Text style={styles.sectionHeadingGreen}>
                {fields.CERTIFICATIONS_HEADING || "CERTIFICATIONS"}
              </Text>
              <View style={styles.certificationsRow}>
                {assets.ENERGY_STAR_LOGO ? (
                  <Image
                    src={assets.ENERGY_STAR_LOGO}
                    style={styles.certLogo}
                  />
                ) : (
                  <View style={styles.certLogoPlaceholder} />
                )}
                {assets.UL_LOGO ? (
                  <Image src={assets.UL_LOGO} style={styles.certLogo} />
                ) : (
                  <View style={styles.certLogoPlaceholder} />
                )}
                {assets.ROHS_LOGO ? (
                  <Image src={assets.ROHS_LOGO} style={styles.certLogo} />
                ) : (
                  <View style={styles.certLogoPlaceholder} />
                )}
                {assets.FCC_LOGO ? (
                  <Image src={assets.FCC_LOGO} style={styles.certLogo} />
                ) : (
                  <View style={styles.certLogoPlaceholder} />
                )}
              </View>
              <Text style={styles.certificationNote}>
                {fields.CERTIFICATION_NOTE ||
                  "*No Energy Star certification for 2200K, 5500K, and 6000K"}
              </Text>
            </View>
          </View>

          {/* Right column */}
          <View style={styles.rightColumn}>
            <View style={styles.productImageContainer}>
              {assets.PRODUCT_IMAGE ? (
                <Image src={assets.PRODUCT_IMAGE} style={styles.productImage} />
              ) : (
                <View
                  style={[styles.productImage, { backgroundColor: "#e0e0e0" }]}
                />
              )}
            </View>

            <Text style={styles.specsTitle}>
              {fields.SPECIFICATIONS_HEADING || "SPECIFICATIONS"}
            </Text>

            {specSections.map((section, sIdx) => (
              <View key={sIdx} style={styles.specsSection}>
                {section.title ? (
                  <Text style={styles.specsSectionTitle}>{section.title}</Text>
                ) : null}
                {section.items &&
                  section.items.map((item, i) => (
                    <View key={i} style={styles.specRow}>
                      <View style={styles.specLabelCell}>
                        <Text style={styles.specLabelText}>{item.label}</Text>
                      </View>
                      <View style={styles.specValueCell}>
                        <Text style={styles.specValueText}>{item.value}</Text>
                      </View>
                    </View>
                  ))}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footerRow}>
          <Text>{fields.FOOTER_LEFT || ""}</Text>
          <Text>{fields.FOOTER_RIGHT || ""}</Text>
        </View>
      </Page>
    </Document>
  );
}
