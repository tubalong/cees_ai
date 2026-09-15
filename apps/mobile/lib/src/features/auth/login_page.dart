import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';

String? _requiredValue(BuildContext context, String? value) =>
    value == null || value.trim().isEmpty ? context.tr('login.required') : null;

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({required this.onLogin, super.key});
  final Future<void> Function(String tenantCode, String account, String password) onLogin;

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final formKey = GlobalKey<FormState>();
  final tenantController = TextEditingController();
  final accountController = TextEditingController();
  final passwordController = TextEditingController();

  @override
  void dispose() {
    tenantController.dispose();
    accountController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(authControllerProvider).isLoading;
    ref.listen(authControllerProvider, (_, next) { 
      next.whenOrNull(error: (error, __) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(error))));
      });
    });

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      width: 58,
                      height: 58,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Color(0xff3478ff), Color(0xff8b4dff)]),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Text('B', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700)),
                    ),
                    const SizedBox(height: 28),
                    Text(context.tr('login.title'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text(context.tr('login.subtitle'), style: const TextStyle(color: Color(0xff7f8898))),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: tenantController,
                      decoration: InputDecoration(labelText: context.tr('login.tenantCode'), prefixIcon: const Icon(Icons.apartment_outlined)),
                      validator: (v) => _requiredValue(context, v),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: accountController,
                      decoration: InputDecoration(labelText: context.tr('login.account'), prefixIcon: const Icon(Icons.person_outline)),
                      validator: (v) => _requiredValue(context, v),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: passwordController,
                      obscureText: true,
                      decoration: InputDecoration(labelText: context.tr('login.password'), prefixIcon: const Icon(Icons.lock_outline)),
                      validator: (value) => value == null || value.length < 8 ? context.tr('login.passwordMin') : null,
                    ),
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: loading ? null : submit,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                      child: loading ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : Text(context.tr('login.submit')),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () => showDialog<void>(context: context, builder: (_) => const ActivationDialog()),
                      child: Text(context.tr('login.activate')),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> submit() async {
    if (formKey.currentState?.validate() != true) return;
    await widget.onLogin(tenantController.text, accountController.text, passwordController.text);
  }
}

class ActivationDialog extends ConsumerStatefulWidget {
  const ActivationDialog({super.key});

  @override
  ConsumerState<ActivationDialog> createState() => _ActivationDialogState();
}

class _ActivationDialogState extends ConsumerState<ActivationDialog> {
  final formKey = GlobalKey<FormState>();
  final fields = List.generate(4, (_) => TextEditingController());
  bool loading = false;

  @override
  void dispose() {
    for (final field in fields) {
      field.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(context.tr('activate.title')),
      content: Form(
        key: formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              field(context, 0, context.tr('login.tenantCode')),
              field(context, 1, context.tr('activate.memberAccount')),
              field(context, 2, context.tr('activate.token'), lines: 2),
              field(context, 3, context.tr('activate.newPassword'), password: true),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: loading ? null : () => Navigator.pop(context), child: Text(context.tr('common.cancel'))),
        FilledButton(onPressed: loading ? null : submitActivation, child: Text(loading ? context.tr('activate.loading') : context.tr('activate.submit'))),
      ],
    );
  }

  Widget field(BuildContext context, int index, String label, {int lines = 1, bool password = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextFormField(
        controller: fields[index],
        maxLines: lines,
        obscureText: password,
        decoration: InputDecoration(labelText: label),
        validator: (v) => _requiredValue(context, v),
      ),
    );
  }

  Future<void> submitActivation() async {
    if (formKey.currentState?.validate() != true) return;
    setState(() => loading = true);
    try {
      await ref.read(mobileApiProvider).activate(
            tenantCode: fields[0].text,
            account: fields[1].text,
            invitationToken: fields[2].text,
            password: fields[3].text,
          );
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.tr('activate.success'))));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(error))));
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }
}
