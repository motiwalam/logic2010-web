package edu.ucla.phil.logic;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Vector;

/**
 * Formula oracle: for each input (a file of JSON strings, one per line) prints what the desktop
 * program's parser and expression code give: the parse results with three flag settings, and
 * for a parsed expression its tree, every printing mode, the FormulaParseNode data, letters,
 * free and bound variables, truth-functional form, quantifier expansion, universal closure,
 * truth table, and a self-match. Then truth-functional equivalence of consecutive formulas.
 *   OracleFormula <inputs.txt>
 */
public class OracleFormula {
   static String unjson(String s) {
      s = s.trim();
      StringBuilder b = new StringBuilder();
      for (int i = 1; i < s.length() - 1; i++) {
         char c = s.charAt(i);
         if (c != '\\') { b.append(c); continue; }
         char d = s.charAt(++i);
         switch (d) {
            case 'n': b.append('\n'); break;
            case 't': b.append('\t'); break;
            case 'r': b.append('\r'); break;
            case 'b': b.append('\b'); break;
            case 'f': b.append('\f'); break;
            case 'u': b.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); i += 4; break;
            default: b.append(d);
         }
      }
      return b.toString();
   }

   static List<String> readInputs(String path) throws Exception {
      List<String> out = new ArrayList<>();
      for (String line : Files.readAllLines(Path.of(path))) if (!line.isEmpty()) out.add(unjson(line));
      return out;
   }

   static String err(Throwable t) {
      if (t instanceof FormulaParseException) return "E:" + t.getMessage();
      return "X:" + t.getClass().getSimpleName();
   }

   /** parseFormula outcome: "N" (null), "OK:<toString>" or an error. */
   static Object[] parse(String s, boolean a, boolean b, boolean c) {
      try {
         Expression e = LogicProgram.parseFormula(s, a, b, c);
         return new Object[] {e == null ? "N" : "OK:" + e, e};
      } catch (Throwable t) {
         return new Object[] {err(t), null};
      }
   }

   static String path(Expression root, Expression target) {
      if (target == null) return "-";
      ExpressionPath p = find(root, target, new ExpressionPath());
      return p == null ? "?" : p.toString();
   }

   static ExpressionPath find(Expression e, Expression target, ExpressionPath p) {
      if (e == target) return (ExpressionPath) p.clone();
      for (int i = 0; i < e.getChildCount(); i++) {
         p.push(i);
         ExpressionPath r = find(e.getChild(i), target, p);
         p.depth--;
         if (r != null) return r;
      }
      return null;
   }

   static String tree(Expression root, Expression e) {
      StringBuilder b = new StringBuilder();
      b.append(e.getKind()).append(':').append(e.getSymbol());
      if (e.displayAsInequality) b.append('!');
      if (e instanceof SimpleTerm) b.append('^').append(path(root, ((SimpleTerm) e).getBinder()));
      if (e.getChildCount() > 0) {
         b.append('(');
         for (int i = 0; i < e.getChildCount(); i++) b.append(i > 0 ? " " : "").append(tree(root, e.getChild(i)));
         b.append(')');
      }
      return b.toString();
   }

   static String safe(java.util.concurrent.Callable<Object> c) {
      try {
         Object o = c.call();
         return o == null ? "null" : o.toString();
      } catch (Throwable t) {
         return err(t);
      }
   }

   static String range(int[] r) {
      return r == null ? "null" : r[0] + "-" + r[1];
   }

   static void nodes(FormulaParseNode n, StringBuilder b) {
      if (b.length() > 0) b.append('|');
      b.append(safe(() -> range(n.getTextRange()))).append(';').append(safe(() -> n.toString())).append(';')
         .append(safe(() -> n.getNotationCode())).append(';').append(n.offset).append(',').append(n.length).append(';')
         .append(safe(() -> n.getOperatorRanges().toString())).append(';').append(safe(() -> n.getPath().toString()));
      for (int i = 0; i < n.getChildCount(); i++) nodes(n.getChild(i), b);
   }

   static String nodeData(FormulaParseNode n) {
      if (n.expression == null) return "noexpr;" + safe(() -> n.isParenthesizationValid());
      StringBuilder b = new StringBuilder();
      nodes(n, b);
      return n.getStructureString() + "#" + safe(() -> n.isParenthesizationValid()) + "#" + b;
   }

   static String letters(Vector v) {
      StringBuilder b = new StringBuilder();
      for (Object o : v) b.append(b.length() > 0 ? "," : "").append(o);
      return b.toString();
   }

   static String truth(Expression e) {
      TruthTableEvaluator t = new TruthTableEvaluator(e);
      StringBuilder b = new StringBuilder();
      for (Object o : t.sentenceLetters) b.append(o).append(',');
      b.append('=');
      for (boolean r : t.rowResults) b.append(r ? '1' : '0');
      return b.toString();
   }

   public static void main(String[] args) throws Exception {
      Oracle.init();
      List<String> inputs = readInputs(args[0]);
      StringBuilder out = new StringBuilder("{\"syntax\":" + FormulaParser.syntax + ",\"items\":[\n");
      List<Expression> formulas = new ArrayList<>();
      boolean first = true;
      for (String s : inputs) {
         Object[] p0 = parse(s, false, false, false);
         Object[] p1 = parse(s, true, false, false);
         Object[] p2 = parse(s, true, true, true);
         out.append(first ? "" : ",\n").append("{\"in\":").append(Oracle.q(s)).append(",\"p0\":").append(Oracle.q(p0[0]))
            .append(",\"p1\":").append(Oracle.q(p1[0])).append(",\"p2\":").append(Oracle.q(p2[0]));
         first = false;
         Expression e = (Expression) p2[1];
         if (e != null) {
            if (e instanceof Formula && formulas.size() < 3000) formulas.add(e);
            out.append(",\"tree\":").append(Oracle.q(tree(e, e)));
            out.append(",\"fmt\":[").append(Oracle.q(e.toString())).append(',').append(Oracle.q(e.formatFull(0))).append(',')
               .append(Oracle.q(e.formatMinimal(-1))).append(',').append(Oracle.q(e.formatFull(-1))).append(',')
               .append(Oracle.q(e.formatMinimal(1))).append(',').append(Oracle.q(e.toFullyParenthesizedString())).append(',')
               .append(Oracle.q(e.toCanonicalString())).append(']');
            final String text = s;
            out.append(",\"nodeText\":").append(Oracle.q(safe(() -> nodeData(new FormulaParseNode(text)))));
            out.append(",\"nodeFmt\":").append(Oracle.q(safe(() -> nodeData(new FormulaParseNode(e, true, 0)))));
            out.append(",\"nodeFull\":").append(Oracle.q(safe(() -> nodeData(new FormulaParseNode(e, false, -1)))));
            out.append(",\"letters\":").append(Oracle.q(safe(() -> letters(e.getSchematicLetters()))));
            out.append(",\"free\":").append(Oracle.q(safe(() -> letters(e.getFreeVariables()))));
            out.append(",\"bound\":").append(Oracle.q(safe(() -> e.getBoundVariableNames().encode())));
            out.append(",\"tf\":").append(Oracle.q(safe(() -> e.toTruthFunctionalForm())));
            out.append(",\"ex\":").append(Oracle.q(safe(() -> e.expandQuantifiers(2, LogicProgram.variableLetter(0)))));
            out.append(",\"ex3\":").append(Oracle.q(safe(() -> e.expandQuantifiers(3, "n"))));
            out.append(",\"exo\":").append(Oracle.q(safe(() -> e.expandOutermostQuantifier(2, LogicProgram.variableLetter(0)))));
            out.append(",\"uc\":").append(Oracle.q(safe(() -> e.universalClosure())));
            out.append(",\"tt\":").append(Oracle.q(safe(() -> truth(e))));
            out.append(",\"ttf\":").append(Oracle.q(safe(() -> truth(e.toTruthFunctionalForm()))));
            out.append(",\"mis\":").append(Oracle.q(safe(() -> e.findMislinkedVariables() == null ? "none" : "some")));
            out.append(",\"self\":").append(Oracle.q(safe(() -> {
               SchemeInstantiation inst = new SchemeInstantiation();
               boolean ok = e.match(e.copy(), inst);
               return ok + ";" + inst.encode() + ";" + inst.pendingLettersToString() + ";" + inst.errorId;
            })));
         }
         out.append('}');
      }
      out.append("\n],\"equivalent\":[");
      for (int i = 0; i + 1 < formulas.size(); i++) {
         final Expression a = formulas.get(i), b = formulas.get(i + 1);
         out.append(i > 0 ? "," : "").append(Oracle.q(safe(() -> TruthTableEvaluator.areEquivalent(a, b)
            + "," + TruthTableEvaluator.areEquivalent(a.toTruthFunctionalForm(), b.toTruthFunctionalForm())
            + "," + TruthTableEvaluator.areEquivalent(a, a.toTruthFunctionalForm()))));
      }
      out.append("]}\n");
      System.out.print(out);
   }
}
