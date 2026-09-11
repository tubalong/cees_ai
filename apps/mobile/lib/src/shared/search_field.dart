import 'package:flutter/material.dart';

class SearchField extends StatelessWidget {
  const SearchField(
      {super.key,
      required this.hintText,
      required this.onChanged,
      this.controller});

  final String hintText;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 48,
        child: TextField(
          controller: controller,
          onChanged: onChanged,
          textAlignVertical: TextAlignVertical.center,
          style: const TextStyle(fontSize: 14, color: Color(0xff273142)),
          decoration: InputDecoration(
            hintText: hintText,
            hintStyle: const TextStyle(fontSize: 14, color: Color(0xff9ca4b4)),
            prefixIcon: const Icon(Icons.search_rounded,
                size: 21, color: Color(0xff7f8898)),
            prefixIconConstraints:
                const BoxConstraints(minWidth: 46, minHeight: 48),
            contentPadding: const EdgeInsets.symmetric(horizontal: 14),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(15),
              borderSide: BorderSide.none,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(15),
              borderSide: const BorderSide(color: Color(0xffe4e8f0)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(15),
              borderSide:
                  const BorderSide(color: Color(0xff5964ff), width: 1.2),
            ),
          ),
        ),
      );
}
