package edu.ucla.phil.logic;

import java.util.Enumeration;
import java.util.Hashtable;

/** Iteration order of java.util.Hashtable for a scripted history of puts and removes. */
public class OracleHashtable {
   public static void main(String[] args) {
      Hashtable<String, Integer> t = new Hashtable<>();
      StringBuilder out = new StringBuilder("[");
      for (int i = 0; i < 60; i++) {
         t.put("k" + (i * 7919 % 101), i);
         if (i % 5 == 4) t.remove("k" + ((i - 2) * 7919 % 101));
         if (i % 10 == 9) {
            StringBuilder b = new StringBuilder();
            for (Enumeration<String> e = t.keys(); e.hasMoreElements();) b.append(e.nextElement()).append(' ');
            out.append(out.length() > 1 ? "," : "").append(Oracle.q(b.toString().trim()));
         }
      }
      System.out.println(out.append("]"));
   }
}
