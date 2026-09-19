import java.io.File;
import java.util.*;
import org.verapdf.gf.foundry.VeraGreenfieldFoundryProvider;
import org.verapdf.pdfa.Foundries;
import org.verapdf.pdfa.PDFAParser;
import org.verapdf.pdfa.PDFAValidator;
import org.verapdf.pdfa.flavours.PDFAFlavour;
import org.verapdf.pdfa.results.TestAssertion;
import org.verapdf.pdfa.results.ValidationResult;

/**
 * veraPDF's own validation engine, behind the command line `validateUa.mts`
 * already expects: `-f ua1 --format mrr <pdf>`, machine-readable report on
 * stdout. The project's CLI distribution is not on Maven Central; the
 * validation model is, so this is the same rules and the same parser.
 */
public class UaCli {
  static String esc(String s) {
    if (s == null) return "";
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }

  public static void main(String[] args) throws Exception {
    String path = null;
    for (String a : args) if (!a.startsWith("-") && !a.equals("ua1") && !a.equals("mrr")) path = a;
    if (path == null) { System.err.println("usage: UaCli [-f ua1] [--format mrr] <pdf>"); System.exit(2); }

    VeraGreenfieldFoundryProvider.initialise();
    ValidationResult result;
    try (PDFAParser parser = Foundries.defaultInstance().createParser(new File(path), PDFAFlavour.PDFUA_1);
         PDFAValidator validator = Foundries.defaultInstance().createValidator(PDFAFlavour.PDFUA_1, false)) {
      result = validator.validate(parser);
    }

    Map<String, List<TestAssertion>> byRule = new LinkedHashMap<>();
    for (TestAssertion a : result.getTestAssertions()) {
      if (a.getStatus() != TestAssertion.Status.FAILED) continue;
      String key = a.getRuleId().getClause() + "|" + a.getRuleId().getTestNumber();
      byRule.computeIfAbsent(key, k -> new ArrayList<>()).add(a);
    }

    StringBuilder sb = new StringBuilder();
    sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<report>\n");
    sb.append("  <validationReport isCompliant=\"").append(result.isCompliant()).append("\">\n");
    for (Map.Entry<String, List<TestAssertion>> e : byRule.entrySet()) {
      String[] k = e.getKey().split("\\|");
      List<TestAssertion> hits = e.getValue();
      sb.append("    <rule clause=\"").append(esc(k[0])).append("\" testNumber=\"").append(esc(k[1]))
        .append("\" status=\"failed\" failedChecks=\"").append(hits.size()).append("\">\n");
      sb.append("      <description>").append(esc(hits.get(0).getMessage())).append("</description>\n");
      for (TestAssertion a : hits) {
        String ctx = a.getLocation() == null ? "" : a.getLocation().getContext();
        sb.append("      <context>").append(esc(ctx)).append("</context>\n");
      }
      sb.append("    </rule>\n");
    }
    sb.append("  </validationReport>\n</report>\n");
    System.out.print(sb);
    System.exit(result.isCompliant() ? 0 : 1);
  }
}
